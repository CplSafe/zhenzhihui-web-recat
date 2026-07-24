import type { GenerationModelGroup, GenerationModelOption, GenerationModelSubgroup } from './GenerationModelPicker'

function copyModels(models: GenerationModelOption[] | undefined): GenerationModelOption[] | undefined {
  return models?.length ? [...models] : undefined
}

function copyActiveSubgroups(
  subgroups: GenerationModelSubgroup[] | undefined,
  activeOperations: ReadonlySet<string>,
): GenerationModelSubgroup[] | undefined {
  const activeSubgroups = (subgroups ?? [])
    .filter((subgroup) => activeOperations.has(subgroup.key))
    .map((subgroup) => ({
      ...subgroup,
      models: [...subgroup.models],
    }))

  return activeSubgroups.length ? activeSubgroups : undefined
}

/**
 * Returns a detached picker model containing only the requested operation codes.
 *
 * A top-level model list represents the operation stored in `group.key`, while
 * subgroup model lists represent their own operation keys. Keeping the filter
 * independent from selection state lets callers hide irrelevant operations
 * without discarding selections that may become relevant again.
 */
export function filterGenerationModelGroupsByOperations(
  groups: GenerationModelGroup[],
  operationCodes: readonly string[],
): GenerationModelGroup[] {
  const activeOperations = new Set(operationCodes)

  return groups.flatMap((group) => {
    const models = activeOperations.has(group.key) ? copyModels(group.models) : undefined
    const subgroups = copyActiveSubgroups(group.subgroups, activeOperations)

    if (!models?.length && !subgroups?.length) return []

    return [
      {
        ...group,
        models,
        subgroups,
      },
    ]
  })
}
