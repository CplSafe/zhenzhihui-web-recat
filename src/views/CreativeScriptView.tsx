/*
  CreativeScriptView — 创意脚本全流程主视图（项目最大页面）
  管理从 Prompt 输入到视频生成的完整链路：
    1. 输入描述 → 生成创意脚本（含分镜词 JSON）
    2. 分镜图生成（支持编辑/替换/插入/历史版本）
    3. 时间线编辑（分段旁白/字幕/音效）
    4. 视频生成与发布
  全部编排逻辑已抽到 useCreativeWorkflow（headless 容器 hook）；本视图只负责渲染。
*/
import './CreativeScriptView.css'
import '@/styles/creative.css'
import type { ReactNode } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import AppToast from '@/components/AppToast'
import CreativeHeroTitle from '@/components/creative/CreativeHeroTitle'
import CreativeTopbar from '@/components/creative/CreativeTopbar'
import CreativeDraftHistoryDrawer from '@/components/creative/CreativeDraftHistoryDrawer'
import CreativeVersionHistoryDrawer from '@/components/creative/CreativeVersionHistoryDrawer'
import DraftSavedDialog from '@/components/creative/DraftSavedDialog'
import GeneratedScriptPanel from '@/components/creative/GeneratedScriptPanel'
import MaterialPreviewModal from '@/components/creative/MaterialPreviewModal'
import PromptComposer from '@/components/creative/PromptComposer'
import SelectedMaterials from '@/components/creative/SelectedMaterials'
import StoryboardEditDialog from '@/components/creative/StoryboardEditDialog'
import type { StoryboardEditMaterial } from '@/components/creative/StoryboardEditDialog'
import StoryboardGenerationPanel from '@/components/creative/StoryboardGenerationPanel'
import TimelineEditorPanel from '@/components/creative/TimelineEditorPanel'
import VideoGenerationPanel from '@/components/creative/VideoGenerationPanel'
import MaterialLibraryPicker from '@/components/material/MaterialLibraryPicker'
import { useCreativeWorkflow } from '@/composables/useCreativeWorkflow'

interface CreativeScriptViewProps {
  // 原视图通过 props auth-session / emit('logout-success') 与 App 通信，
  // React 改用 useAuth()。logout 仍可由父级透传回调。
  onLogoutSuccess?: () => void
}

export default function CreativeScriptView(props: CreativeScriptViewProps): ReactNode {
  return <CreativeScriptViewBody onLogoutSuccess={props.onLogoutSuccess} />
}

function CreativeScriptViewBody(props: CreativeScriptViewProps): ReactNode {
  const vm = useCreativeWorkflow(props)
  const {
    navigate,
    description,
    setDescription,
    generatedPrompt,
    generatedScript,
    setGeneratedScript,
    generationPending,
    isSubmittingScript,
    isScriptStreaming,
    isGenerating,
    draftSavedDialogOpen,
    setDraftSavedDialogOpen,
    currentStep,
    maxStepIndex,
    previewMaterial,
    activeMenu,
    selectedPlatform,
    selectedDuration,
    selectedRatio,
    selectedStyles,
    customStyle,
    setCustomStyle,
    libraryTab,
    setLibraryTab,
    libraryQuery,
    setLibraryQuery,
    storyboardPreviewMaterials,
    libraryOpen,
    selectedMaterials,
    selectedMaterialIds,
    setLibraryOpen,
    projectId,
    isBlankMode,
    durations,
    ratios,
    styleOptions,
    creativeStoryboards,
    timelineState,
    timelineReloading,
    timelineReloadReady,
    workspaceId,
    headerStyle,
    promptStyle,
    selectedStyleBox,
    storyboardStyle,
    timelineStyle,
    videoStyle,
    selectedStyleText,
    compactPromptText,
    storyboardOutline,
    compactMaterialStack,
    timelineTotalDuration,
    storyboardHistoryItems,
    storyboardSelectedHistoryItems,
    canGenerateStoryboard,
    storyboardItems,
    storyboardTotal,
    storyboardGenerating,
    isModifyingStoryboardImage,
    reorderStoryboardItems,
    storyboardGeneratedCount,
    nextStoryboardTitle,
    editingStoryboardItem,
    editingStoryboardIndex,
    canGenerateTimeline,
    projectTitle,
    displayProjectName,
    removeStoryboardItem,
    stepStoryboardVersionFromPanel,
    setStoryboardVersionFromPanel,
    removeStoryboardVersionFromPanel,
    generatedVideoUrl,
    generatedVideoTask,
    videoHistoryList,
    activeVideoHistoryId,
    isVideoGenerating,
    videoProgress,
    generateVideo,
    regenerateVideo,
    modifyVideoWithPrompt,
    handleSelectVideoHistory,
    deleteVideoHistoryItem,
    handleVideoNotify,
    saveVideoDraft,
    publishVideo,
    videoCostEstimate,
    isEstimatingVideoCost,
    videoCostEstimateError,
    estimateVideoCost,
    toggleMenu,
    selectOption,
    toggleStyle,
    addCustomStyle,
    handleStoryboardsParsed,
    handleStoryboardsUpdated,
    updatePromptTextFromPanel,
    generateScript,
    copyScript,
    regenerateScript,
    generateTimeline,
    handleTimelineUpdate,
    handleTimelineSynced,
    handleTimelineStoryboardPromptUpdate,
    reloadTimeline,
    approveTimelineReload,
    openStoryboardEditor,
    closeStoryboardEditor,
    confirmStoryboardEdit,
    handleSelectStoryboardItem,
    handleDirectReplaceStoryboardImage,
    handleDirectInsertStoryboardImage,
    cancelAiAnalyzeRequest,
    handleDownloadVideo,
    handleAnalyzeReferenceImage,
    modifyStoryboardFromPanel,
    generateStoryboard,
    regenerateStoryboard,
    insertStoryboardItem,
    insertIdeaText,
    insertIdeaLoading,
    resetInsertIdea,
    suggestInsertIdea,
    isUploadingSelected,
    isUploadingLibrary,
    isLoadingLibrary,
    handleSelectedFiles,
    handleLibraryFiles,
    previewSelectedMaterial,
    removeSelectedMaterial,
    openLibrary,
    openLibraryForStoryboardEditor,
    addMaterialsFromLibrary,
    removeMaterialsFromLibrary,
    removeStoryboardPreviewMaterial,
    filteredLibraryMaterials,
    closePreview,
    handleSaveDraft,
    handleSaveVideo,
    handleRedraw,
    switchToStep,
    draftHistoryOpen,
    setDraftHistoryOpen,
    draftHistoryLoading,
    draftHistoryProjects,
    isDeletingDraftProject,
    openDraftHistory,
    continueFromDraftProject,
    deleteDraftProject,
    deleteDraftProjects,
    versionDrawerOpen,
    isLoadingVersions,
    isSavingVersion,
    isDeletingVersion,
    isRestoringVersion,
    isLoadingVersionDetail,
    versionHistoryList,
    selectedVersionId,
    selectedVersionDetail,
    versionTargetProjectId,
    openVersionHistoryForDraft,
    closeVersionHistoryDrawer,
    loadCreativeProjectVersionDetail,
    saveCreativeProjectVersion,
    restoreCreativeProjectVersionByItem,
    deleteCreativeProjectVersionByItem,
    showToastRef,
  } = vm

  return renderBody()

  function renderBody(): any {
    return (
      <AppLayout activeNav="分步创作" onLogoutSuccess={() => props.onLogoutSuccess?.()}>
        <AppToast />
        <DraftSavedDialog
          open={draftSavedDialogOpen}
          onClose={() => setDraftSavedDialogOpen(false)}
          onOpenHistory={() => {
            setDraftSavedDialogOpen(false)
            openDraftHistory()
          }}
        />
        <CreativeTopbar
          activeStep={currentStep}
          maxStepIndex={maxStepIndex}
          projectName={displayProjectName}
          disableSaveDraft={isBlankMode}
          onSaveDraft={handleSaveDraft}
          onOpenDrafts={openDraftHistory}
          onRedraw={handleRedraw}
          onSwitchStep={switchToStep}
        />

        <CreativeDraftHistoryDrawer
          open={draftHistoryOpen}
          projects={draftHistoryProjects}
          loading={draftHistoryLoading}
          deleting={isDeletingDraftProject}
          currentWorkspaceId={workspaceId}
          currentProjectId={projectId}
          onClose={() => setDraftHistoryOpen(false)}
          onSelect={continueFromDraftProject}
          onVersions={openVersionHistoryForDraft}
          onDelete={deleteDraftProject}
          onDeleteMany={deleteDraftProjects}
        />

        <CreativeVersionHistoryDrawer
          open={versionDrawerOpen}
          versions={versionHistoryList}
          loading={isLoadingVersions}
          saving={isSavingVersion}
          deleting={isDeletingVersion}
          restoring={isRestoringVersion}
          selectedVersionId={selectedVersionId}
          detail={selectedVersionDetail}
          detailLoading={isLoadingVersionDetail}
          allowSave={!isBlankMode && !versionTargetProjectId}
          onClose={closeVersionHistoryDrawer}
          onSave={(label: any) => saveCreativeProjectVersion({ label })}
          onSelect={loadCreativeProjectVersionDetail}
          onRestore={restoreCreativeProjectVersionByItem}
          onDelete={deleteCreativeProjectVersionByItem}
        />

        <div className="main-canvas"></div>

        {isBlankMode ? (
          <div className="creative-empty">
            <div className="creative-empty-card">
              <strong>开始创作</strong>
              <p>重新登录默认进入空白页。请在「历史草稿」里选择你之前的项目继续编辑，或创建新项目。</p>
              <div className="creative-empty-actions">
                <button type="button" className="creative-empty-primary" onClick={openDraftHistory}>
                  从历史草稿继续
                </button>
                <button
                  type="button"
                  className="creative-empty-secondary"
                  onClick={() => navigate('/creative')}
                >
                  创建新项目
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div key={currentStep}>
              {currentStep === 'script' && <CreativeHeroTitle headerStyle={headerStyle} />}

              {currentStep === 'script' && !isGenerating ? (
                <PromptComposer
                  panelStyle={promptStyle}
                  description={description}
                  activeMenu={activeMenu}
                  selectedDuration={selectedDuration}
                  selectedRatio={selectedRatio}
                  selectedStyleText={selectedStyleText}
                  durations={durations}
                  ratios={ratios}
                  styleOptions={styleOptions}
                  selectedStyles={selectedStyles}
                  customStyle={customStyle}
                  isUploading={isUploadingSelected}
                  isGenerating={isSubmittingScript}
                  onUpdateDescription={(v: string) => setDescription(v)}
                  onUpdateCustomStyle={(v: string) => setCustomStyle(v)}
                  onFilesUpload={handleSelectedFiles}
                  onToggleMenu={toggleMenu}
                  onSelectOption={selectOption}
                  onToggleStyle={toggleStyle}
                  onAddCustomStyle={addCustomStyle}
                  onGenerate={generateScript}
                />
              ) : currentStep === 'script' ? (
                <GeneratedScriptPanel
                  panelStyle={promptStyle}
                  compactMaterialStack={compactMaterialStack}
                  compactPromptText={compactPromptText}
                  promptText={compactPromptText}
                  activeMenu={activeMenu}
                  selectedDuration={selectedDuration}
                  selectedRatio={selectedRatio}
                  selectedStyleText={selectedStyleText}
                  durations={durations}
                  ratios={ratios}
                  styleOptions={styleOptions}
                  selectedStyles={selectedStyles}
                  customStyle={customStyle}
                  generatedScript={generatedScript}
                  isPending={generationPending || isSubmittingScript}
                  isStreaming={isScriptStreaming}
                  canGenerateStoryboard={canGenerateStoryboard}
                  onOpenLibrary={openLibrary}
                  onToggleMenu={toggleMenu}
                  onSelectOption={selectOption}
                  onToggleStyle={toggleStyle}
                  onCustomStyleChange={(v: string) => setCustomStyle(v)}
                  onAddCustomStyle={addCustomStyle}
                  onGenerate={generateScript}
                  onCopy={copyScript}
                  onRegenerate={regenerateScript}
                  onGeneratedScriptChange={(v: string) => setGeneratedScript(v)}
                  onGenerateStoryboard={generateStoryboard}
                  onStoryboardsParsed={handleStoryboardsParsed}
                  onStoryboardsUpdated={handleStoryboardsUpdated}
                  onRemoveMaterial={removeSelectedMaterial}
                  onPromptTextChange={updatePromptTextFromPanel}
                />
              ) : null}

              {currentStep === 'script' && !isGenerating && selectedMaterials.length ? (
                <SelectedMaterials
                  panelStyle={selectedStyleBox}
                  materials={selectedMaterials}
                  onPreview={previewSelectedMaterial}
                  onRemove={removeSelectedMaterial}
                  onOpenLibrary={openLibrary}
                />
              ) : null}

              {currentStep === 'storyboard' && (
                <StoryboardGenerationPanel
                  panelStyle={storyboardStyle}
                  isLibraryOpen={libraryOpen}
                  selectedRatio={selectedRatio}
                  items={storyboardItems}
                  total={storyboardTotal}
                  generatedCount={storyboardGeneratedCount}
                  isGenerating={storyboardGenerating}
                  nextTitle={nextStoryboardTitle}
                  canGenerateTimeline={canGenerateTimeline}
                  historyItems={storyboardSelectedHistoryItems}
                  isSubmittingEdit={isModifyingStoryboardImage}
                  insertIdeaText={insertIdeaText}
                  insertIdeaLoading={insertIdeaLoading}
                  selectedMaterials={storyboardPreviewMaterials}
                  onPreview={openStoryboardEditor}
                  onRemove={removeStoryboardItem}
                  onReorder={reorderStoryboardItems}
                  onRegenerate={regenerateStoryboard}
                  onGenerateStoryboard={generateStoryboard}
                  onGenerateTimeline={generateTimeline}
                  onSelectItem={handleSelectStoryboardItem}
                  onModifyImage={modifyStoryboardFromPanel}
                  onStepImageVersion={stepStoryboardVersionFromPanel}
                  onSetImageVersion={setStoryboardVersionFromPanel}
                  onRemoveImageVersion={removeStoryboardVersionFromPanel}
                  onInsertItem={insertStoryboardItem}
                  onSuggestInsertIdea={suggestInsertIdea}
                  onResetInsertIdea={resetInsertIdea}
                  onOpenLibrary={openLibraryForStoryboardEditor}
                  onRemoveMaterial={removeStoryboardPreviewMaterial}
                  onUploadReplaceStoryboard={handleDirectReplaceStoryboardImage}
                  onUploadInsertStoryboard={handleDirectInsertStoryboardImage}
                  onAnalyzeReferenceImage={handleAnalyzeReferenceImage}
                  onCancelAiAnalyze={cancelAiAnalyzeRequest}
                />
              )}

              {currentStep === 'timeline' && (
                <TimelineEditorPanel
                  panelStyle={timelineStyle}
                  selectedRatio={selectedRatio}
                  storyboardItems={storyboardItems}
                  storyboards={creativeStoryboards}
                  timeline={timelineState}
                  totalDuration={timelineTotalDuration}
                  isReloading={timelineReloading}
                  reloadReady={timelineReloadReady}
                  videoCostEstimate={videoCostEstimate}
                  isEstimatingVideoCost={isEstimatingVideoCost}
                  videoCostEstimateError={videoCostEstimateError}
                  onEstimateVideoCost={estimateVideoCost}
                  onUpdateTimeline={handleTimelineUpdate}
                  onUpdateStoryboardPrompt={handleTimelineStoryboardPromptUpdate}
                  onSynced={handleTimelineSynced}
                  onGenerateVideo={generateVideo}
                  onReload={reloadTimeline}
                  onApproveReload={approveTimelineReload}
                  onComingSoon={(label: string) => showToastRef.current(`${label}功能即将开放`, 'success')}
                />
              )}

              {currentStep === 'video' && (
                <VideoGenerationPanel
                  panelStyle={videoStyle}
                  videoUrl={generatedVideoUrl}
                  isGenerating={isVideoGenerating}
                  generationProgress={videoProgress}
                  taskStatus={generatedVideoTask?.status || ''}
                  selectedDuration={selectedDuration}
                  selectedRatio={selectedRatio}
                  selectedPlatform={selectedPlatform}
                  selectedStyleText={selectedStyleText}
                  creativePrompt={storyboardOutline || generatedPrompt || description}
                  projectName={projectTitle}
                  videoHistory={videoHistoryList}
                  activeHistoryId={activeVideoHistoryId}
                  onRegenerate={regenerateVideo}
                  onModifyVideo={modifyVideoWithPrompt}
                  onSelectHistory={handleSelectVideoHistory}
                  onDeleteHistory={deleteVideoHistoryItem}
                  onSaveDraft={saveVideoDraft}
                  onSaveVideo={handleSaveVideo}
                  onDownloadVideo={handleDownloadVideo}
                  onPublishVideo={publishVideo}
                  onNotify={handleVideoNotify}
                />
              )}
            </div>

            <StoryboardEditDialog
              item={editingStoryboardItem}
              itemIndex={editingStoryboardIndex}
              materials={selectedMaterials as StoryboardEditMaterial[]}
              historyItems={storyboardHistoryItems}
              isSubmitting={isModifyingStoryboardImage}
              onClose={closeStoryboardEditor}
              onConfirm={confirmStoryboardEdit}
              onOpenLibrary={openLibrary}
              onRemoveMaterial={removeSelectedMaterial}
            />

            <MaterialLibraryPicker
              modelValue={libraryOpen}
              onModelValueChange={(v: boolean) => setLibraryOpen(v)}
              workspaceId={workspaceId}
              projectName={projectTitle}
              materials={filteredLibraryMaterials}
              selectedMaterialIds={selectedMaterialIds}
              tab={libraryTab}
              query={libraryQuery}
              isLoading={isLoadingLibrary}
              isUploading={isUploadingLibrary}
              onTabChange={(v: string) => setLibraryTab(v)}
              onQueryChange={(v: string) => setLibraryQuery(v)}
              onFilesUpload={handleLibraryFiles}
              onConfirm={addMaterialsFromLibrary}
              onBatchDelete={removeMaterialsFromLibrary}
            />

            <MaterialPreviewModal
              material={previewMaterial}
              onClose={closePreview}
              onRemove={removeSelectedMaterial}
            />
          </>
        )}
      </AppLayout>
    )
  }
}
