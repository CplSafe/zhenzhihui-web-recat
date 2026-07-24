import { describe, expect, it } from 'vitest'
import {
  mergeTransactionalScriptResult,
  planSmartImageModelRegeneration,
  resolveSmartShotImageOperation,
} from '@/utils/smartModelSwitchSafety'

describe('mergeTransactionalScriptResult', () => {
  it('keeps only upload/manual versions for subjects present in the new script and removes AI provenance', () => {
    const result = mergeTransactionalScriptResult({
      nextShots: [
        {
          id: 'new-1',
          subjects: [{ tag: '@Alice' }, { tag: 'Bob' }],
        },
        {
          id: 'new-2',
          subjects: [{ tag: 'Alice' }],
        },
      ],
      previousShots: [
        {
          id: 'old-1',
          subjects: [{ tag: '@Alice', image: 'alice-upload', assetId: 11 }],
        },
      ],
      subjectAssets: {
        Alice: {
          versions: ['alice-ai', 'alice-upload', 'alice-manual'],
          prompt: 'Alice prompt',
          sources: {
            'alice-ai': 'ai',
            'alice-upload': 'upload',
            'alice-manual': 'manual',
          },
          ids: {
            'alice-ai': 10,
            'alice-upload': 11,
            'alice-manual': 12,
          },
          operations: {
            'alice-ai': 'image.text_to_image',
            'alice-upload': 'image.image_to_image',
            'alice-manual': 'image.image_to_image',
          },
          modelVersionIds: {
            'alice-ai': 101,
            'alice-upload': 102,
            'alice-manual': 103,
          },
        },
        Bob: {
          versions: ['bob-ai', 'bob-manual'],
          sources: {
            'bob-ai': 'ai',
            'bob-manual': 'manual',
          },
          ids: {
            'bob-ai': 20,
            'bob-manual': 21,
          },
          operations: {
            'bob-ai': 'image.text_to_image',
            'bob-manual': 'image.image_to_image',
          },
          modelVersionIds: {
            'bob-ai': 201,
            'bob-manual': 202,
          },
        },
        RemovedFromScript: {
          versions: ['removed-upload'],
          sources: { 'removed-upload': 'upload' },
          ids: { 'removed-upload': 30 },
        },
      },
    })

    expect(Object.keys(result.subjectAssets)).toEqual(['Alice', 'Bob'])
    expect(result.subjectAssets.Alice).toEqual({
      versions: ['alice-upload', 'alice-manual'],
      prompt: 'Alice prompt',
      sources: {
        'alice-upload': 'upload',
        'alice-manual': 'manual',
      },
      ids: {
        'alice-upload': 11,
        'alice-manual': 12,
      },
      operations: {
        'alice-upload': 'image.image_to_image',
        'alice-manual': 'image.image_to_image',
      },
      modelVersionIds: {
        'alice-upload': 102,
        'alice-manual': 103,
      },
    })
    expect(result.subjectAssets.Bob).toMatchObject({
      versions: ['bob-manual'],
      sources: { 'bob-manual': 'manual' },
      ids: { 'bob-manual': 21 },
    })
    expect(result.shots[0].subjects).toEqual([
      { tag: '@Alice', image: 'alice-upload', assetId: 11 },
      { tag: 'Bob', image: 'bob-manual', assetId: 21 },
    ])
    expect(result.shots[1].subjects).toEqual([{ tag: 'Alice', image: 'alice-upload', assetId: 11 }])
  })
})

describe('planSmartImageModelRegeneration', () => {
  const shots = [
    {
      id: 'shot-t2i-1',
      image: 'shot-1.png',
      imageAssetId: 101,
      imageOperationCode: 'image.text_to_image' as const,
    },
    {
      id: 'shot-i2i-2',
      image: 'shot-2.png',
      imageAssetId: 102,
      imageOperationCode: 'image.image_to_image' as const,
      dependsOnPrevious: true,
    },
    {
      id: 'shot-t2i-3',
      image: 'shot-3.png',
      imageAssetId: 103,
      imageOperationCode: 'image.text_to_image' as const,
      dependsOnPrevious: true,
    },
    {
      id: 'future-empty-shot',
      imageOperationCode: 'image.image_to_image' as const,
      dependsOnPrevious: true,
    },
  ]
  const subjectAssets = {
    TextSubject: {
      versions: ['text-subject-ai'],
      sources: { 'text-subject-ai': 'ai' as const },
      operations: { 'text-subject-ai': 'image.text_to_image' as const },
    },
    ReferenceSubject: {
      versions: ['reference-subject-ai'],
      sources: { 'reference-subject-ai': 'ai' as const },
      operations: { 'reference-subject-ai': 'image.image_to_image' as const },
    },
  }

  it('regenerates only matching t2i/i2i provenance, then replays existing shots after the first affected shot', () => {
    const textPlan = planSmartImageModelRegeneration({
      operationCode: 'image.text_to_image',
      shots,
      subjectAssets,
      subjectHasReference: (name) => name === 'ReferenceSubject',
    })
    const imagePlan = planSmartImageModelRegeneration({
      operationCode: 'image.image_to_image',
      shots,
      subjectAssets,
      subjectHasReference: (name) => name === 'ReferenceSubject',
    })

    expect(textPlan).toMatchObject({
      subjectNames: ['TextSubject'],
      directShotIds: ['shot-t2i-1', 'shot-t2i-3'],
      shotIds: ['shot-t2i-1', 'shot-i2i-2', 'shot-t2i-3'],
      dependencyShotIds: ['shot-i2i-2'],
      firstAffectedShotIndex: 0,
      firstAffectedShotOperation: 'image.text_to_image',
      subjectTaskCount: 1,
      shotTaskCount: 3,
      totalTaskCount: 4,
    })
    expect(imagePlan).toMatchObject({
      subjectNames: ['ReferenceSubject'],
      directShotIds: ['shot-i2i-2'],
      shotIds: ['shot-i2i-2', 'shot-t2i-3'],
      dependencyShotIds: ['shot-t2i-3'],
      firstAffectedShotIndex: 1,
      firstAffectedShotOperation: 'image.image_to_image',
      subjectTaskCount: 1,
      shotTaskCount: 2,
      totalTaskCount: 3,
    })
  })

  it('creates no tasks when the switched operation has no related generated artifact', () => {
    const plan = planSmartImageModelRegeneration({
      operationCode: 'image.text_to_image',
      shots: [
        {
          id: 'existing-i2i',
          image: 'existing-i2i.png',
          imageAssetId: 301,
          imageOperationCode: 'image.image_to_image',
        },
        {
          id: 'empty-t2i',
          imageOperationCode: 'image.text_to_image',
        },
      ],
      subjectAssets: {
        OnlyI2iSubject: {
          versions: ['only-i2i-ai'],
          sources: { 'only-i2i-ai': 'ai' },
          operations: { 'only-i2i-ai': 'image.image_to_image' },
        },
      },
      subjectHasReference: () => true,
    })

    expect(plan).toEqual({
      operationCode: 'image.text_to_image',
      subjectNames: [],
      directShotIds: [],
      shotIds: [],
      dependencyShotIds: [],
      firstAffectedShotIndex: -1,
      firstAffectedShotOperation: null,
      subjectTaskCount: 0,
      shotTaskCount: 0,
      totalTaskCount: 0,
    })
  })
})

describe('legacy image provenance inference', () => {
  it('infers t2i for the first unreferenced frame and i2i for explicit or downstream references', () => {
    expect(
      resolveSmartShotImageOperation(
        {
          id: 'first-legacy',
          image: 'first.png',
          imageVersions: [{ url: 'first.png' }],
        },
        0,
      ),
    ).toBe('image.text_to_image')

    expect(
      resolveSmartShotImageOperation(
        {
          id: 'explicit-ref',
          image: 'ref.png',
          selectedRefs: ['subject.png'],
        },
        0,
      ),
    ).toBe('image.image_to_image')

    expect(
      resolveSmartShotImageOperation(
        {
          id: 'subject-ref',
          image: 'subject-ref.png',
          subjects: [{ tag: '@Alice', assetId: 88 }],
        },
        0,
      ),
    ).toBe('image.image_to_image')

    expect(
      resolveSmartShotImageOperation(
        {
          id: 'downstream-legacy',
          image: 'downstream.png',
        },
        1,
      ),
    ).toBe('image.image_to_image')
  })

  it('infers legacy subject provenance from whether the subject has a reference image', () => {
    const subjectAssets = {
      LegacyTextSubject: {
        versions: ['legacy-text-ai'],
        sources: { 'legacy-text-ai': 'ai' as const },
      },
      LegacyReferenceSubject: {
        versions: ['legacy-reference-ai'],
        sources: { 'legacy-reference-ai': 'ai' as const },
      },
    }
    const subjectHasReference = (name: string) => name === 'LegacyReferenceSubject'

    const textPlan = planSmartImageModelRegeneration({
      operationCode: 'image.text_to_image',
      shots: [],
      subjectAssets,
      subjectHasReference,
    })
    const imagePlan = planSmartImageModelRegeneration({
      operationCode: 'image.image_to_image',
      shots: [],
      subjectAssets,
      subjectHasReference,
    })

    expect(textPlan.subjectNames).toEqual(['LegacyTextSubject'])
    expect(imagePlan.subjectNames).toEqual(['LegacyReferenceSubject'])
  })
})
