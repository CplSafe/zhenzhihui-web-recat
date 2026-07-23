import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage/gated',
      // First gate the shared modules that protect the bugs fixed in this batch.
      // Expand this list as each additional business flow receives regression tests.
      include: [
        'src/api/aiPolish.ts',
        'src/api/aiResponses.ts',
        'src/api/banners.ts',
        'src/api/feedback.ts',
        'src/utils/businessPagination.ts',
        'src/utils/creativeDraftSaveQueue.ts',
        'src/utils/downloadUrlSafety.ts',
        'src/utils/hotCopyDraft.ts',
        'src/utils/loginObservability.ts',
        'src/utils/observabilitySanitizer.ts',
        'src/utils/persistHotCopyResult.ts',
        'src/utils/persistVideoResult.ts',
        'src/utils/smartDraft.ts',
        'src/utils/singleFlight.ts',
        'src/utils/taskProgress.ts',
        'src/utils/uploadUrlSafety.ts',
        'src/utils/urlSafety.ts',
        'src/utils/videoGenRegistry.ts',
        'src/utils/assetUrl.ts',
        'src/utils/swrCache.ts',
        'src/stores/taskCenter.ts',
        'src/api/projectVideos.ts',
        'src/api/smartShotImage.ts',
        'src/api/smartScript.ts',
        'src/api/templates.ts',
        'src/components/auth/AgreementModal.tsx',
        'src/components/hotcopy/HotCopyCaseModal/HotCopyCaseModal.tsx',
        'src/components/smart/MarketingBreakdown/MarketingBreakdown.tsx',
        'src/components/task/TaskCenterCoordinator.tsx',
        'src/components/task/TaskCenterDrawer.tsx',
        'src/views/ProjectVideoDetailView.tsx',
      ],
      thresholds: {
        // A per-file floor prevents well-tested helpers from hiding a
        // regression in a lower-covered business module.
        perFile: true,
        statements: 60,
        branches: 50,
        functions: 50,
        lines: 65,
      },
    },
  },
})
