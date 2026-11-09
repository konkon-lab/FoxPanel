// 由 scripts/gen-openvr.ts 从 openvr_capi.h 生成，请勿手动修改。

export const IVRSystem_VERSION = 'IVRSystem_026';
export const IVRSystem_METHODS = [
  'GetRecommendedRenderTargetSize', 'GetProjectionMatrix', 'GetProjectionRaw', 'ComputeDistortion',
  'ComputeDistortionSet', 'GetEyeToHeadTransform', 'GetTimeSinceLastVsync', 'GetD3D9AdapterIndex',
  'GetDXGIOutputInfo', 'GetOutputDevice', 'IsDisplayOnDesktop', 'SetDisplayVisibility',
  'GetDeviceToAbsoluteTrackingPose', 'GetSeatedZeroPoseToStandingAbsoluteTrackingPose', 'GetRawZeroPoseToStandingAbsoluteTrackingPose', 'GetSortedTrackedDeviceIndicesOfClass',
  'GetTrackedDeviceActivityLevel', 'ApplyTransform', 'GetTrackedDeviceIndexForControllerRole', 'GetControllerRoleForTrackedDeviceIndex',
  'GetTrackedDeviceClass', 'IsTrackedDeviceConnected', 'GetBoolTrackedDeviceProperty', 'GetFloatTrackedDeviceProperty',
  'GetInt32TrackedDeviceProperty', 'GetUint64TrackedDeviceProperty', 'GetMatrix34TrackedDeviceProperty', 'GetArrayTrackedDeviceProperty',
  'GetStringTrackedDeviceProperty', 'GetPropErrorNameFromEnum', 'PollNextEvent', 'PollNextEventWithPose',
  'PollNextEventWithPoseAndOverlays', 'GetEventTypeNameFromEnum', 'GetHiddenAreaMesh', 'GetEyeTrackedFoveationCenter',
  'GetEyeTrackedFoveationCenterForProjection', 'GetControllerState', 'GetControllerStateWithPose', 'TriggerHapticPulse',
  'GetButtonIdNameFromEnum', 'GetControllerAxisTypeNameFromEnum', 'IsInputAvailable', 'IsSteamVRDrawingControllers',
  'ShouldApplicationPause', 'ShouldApplicationReduceRenderingWork', 'PerformFirmwareUpdate', 'AcknowledgeQuit_Exiting',
  'GetAppContainerFilePaths', 'GetRuntimeVersion', 'SetSDKVersion',
] as const;

export const IVROverlay_VERSION = 'IVROverlay_028';
export const IVROverlay_METHODS = [
  'FindOverlay', 'CreateOverlay', 'CreateSubviewOverlay', 'DestroyOverlay',
  'GetOverlayKey', 'GetOverlayName', 'SetOverlayName', 'GetOverlayImageData',
  'GetOverlayErrorNameFromEnum', 'SetOverlayRenderingPid', 'GetOverlayRenderingPid', 'SetOverlayFlag',
  'GetOverlayFlag', 'GetOverlayFlags', 'SetOverlayColor', 'GetOverlayColor',
  'SetOverlayAlpha', 'GetOverlayAlpha', 'SetOverlayTexelAspect', 'GetOverlayTexelAspect',
  'SetOverlaySortOrder', 'GetOverlaySortOrder', 'SetOverlayWidthInMeters', 'GetOverlayWidthInMeters',
  'SetOverlayCurvature', 'GetOverlayCurvature', 'SetOverlayPreCurvePitch', 'GetOverlayPreCurvePitch',
  'SetOverlayTextureColorSpace', 'GetOverlayTextureColorSpace', 'SetOverlayTextureBounds', 'GetOverlayTextureBounds',
  'GetOverlayTransformType', 'SetOverlayTransformAbsolute', 'GetOverlayTransformAbsolute', 'SetOverlayTransformTrackedDeviceRelative',
  'GetOverlayTransformTrackedDeviceRelative', 'SetOverlayTransformTrackedDeviceComponent', 'GetOverlayTransformTrackedDeviceComponent', 'SetOverlayTransformCursor',
  'GetOverlayTransformCursor', 'SetOverlayTransformProjection', 'SetSubviewPosition', 'ShowOverlay',
  'HideOverlay', 'IsOverlayVisible', 'GetTransformForOverlayCoordinates', 'WaitFrameSync',
  'PollNextOverlayEvent', 'GetOverlayInputMethod', 'SetOverlayInputMethod', 'GetOverlayMouseScale',
  'SetOverlayMouseScale', 'ComputeOverlayIntersection', 'IsHoverTargetOverlay', 'SetOverlayIntersectionMask',
  'TriggerLaserMouseHapticVibration', 'SetOverlayCursor', 'SetOverlayCursorPositionOverride', 'ClearOverlayCursorPositionOverride',
  'SetOverlayTexture', 'ClearOverlayTexture', 'SetOverlayRaw', 'SetOverlayFromFile',
  'GetOverlayTexture', 'ReleaseNativeOverlayHandle', 'GetOverlayTextureSize', 'CreateDashboardOverlay',
  'IsDashboardVisible', 'IsActiveDashboardOverlay', 'SetDashboardOverlaySceneProcess', 'GetDashboardOverlaySceneProcess',
  'ShowDashboard', 'GetPrimaryDashboardDevice', 'ShowKeyboard', 'ShowKeyboardForOverlay',
  'GetKeyboardText', 'HideKeyboard', 'SetKeyboardTransformAbsolute', 'SetKeyboardPositionForOverlay',
  'ShowMessageOverlay', 'CloseMessageOverlay',
] as const;

export const IVRInput_VERSION = 'IVRInput_011';
export const IVRInput_METHODS = [
  'SetActionManifestPath', 'GetActionSetHandle', 'GetActionHandle', 'GetInputSourceHandle',
  'UpdateActionState', 'GetDigitalActionData', 'GetAnalogActionData', 'GetPoseActionDataRelativeToNow',
  'GetPoseActionDataForNextFrame', 'GetSkeletalActionData', 'GetDominantHand', 'SetDominantHand',
  'GetEyeTrackingDataRelativeToNow', 'GetEyeTrackingDataForNextFrame', 'GetBoneCount', 'GetBoneHierarchy',
  'GetBoneName', 'GetSkeletalReferenceTransforms', 'GetSkeletalTrackingLevel', 'GetSkeletalBoneData',
  'GetSkeletalSummaryData', 'GetSkeletalBoneDataCompressed', 'DecompressSkeletalBoneData', 'TriggerHapticVibrationAction',
  'GetActionOrigins', 'GetOriginLocalizedName', 'GetOriginTrackedDeviceInfo', 'GetActionBindingInfo',
  'ShowActionOrigins', 'ShowBindingsForActionSet', 'GetComponentStateForBinding', 'IsUsingLegacyInput',
  'OpenBindingUI', 'GetBindingVariant',
] as const;

export const IVRApplications_VERSION = 'IVRApplications_008';
export const IVRApplications_METHODS = [
  'AddApplicationManifest', 'RemoveApplicationManifest', 'IsApplicationInstalled', 'GetApplicationCount',
  'GetApplicationKeyByIndex', 'GetApplicationKeyByProcessId', 'LaunchApplication', 'LaunchTemplateApplication',
  'LaunchApplicationFromMimeType', 'LaunchDashboardOverlay', 'CancelApplicationLaunch', 'IdentifyApplication',
  'GetApplicationProcessId', 'GetApplicationsErrorNameFromEnum', 'GetApplicationPropertyString', 'GetApplicationPropertyBool',
  'GetApplicationPropertyUint64', 'SetApplicationAutoLaunch', 'GetApplicationAutoLaunch', 'SetDefaultApplicationForMimeType',
  'GetDefaultApplicationForMimeType', 'GetApplicationSupportedMimeTypes', 'GetApplicationsThatSupportMimeType', 'GetApplicationLaunchArguments',
  'GetStartingApplication', 'GetSceneApplicationState', 'PerformApplicationPrelaunchCheck', 'GetSceneApplicationStateNameFromEnum',
  'LaunchInternalProcess', 'RegisterSubprocess', 'GetCurrentSceneProcessId',
] as const;

export const IVRRenderModels_VERSION = 'IVRRenderModels_006';
export const IVRRenderModels_METHODS = [
  'LoadRenderModel_Async', 'FreeRenderModel', 'LoadTexture_Async', 'FreeTexture',
  'LoadTextureD3D11_Async', 'LoadIntoTextureD3D11_Async', 'FreeTextureD3D11', 'GetRenderModelName',
  'GetRenderModelCount', 'GetComponentCount', 'GetComponentName', 'GetComponentButtonMask',
  'GetComponentRenderModelName', 'GetComponentStateForDevicePath', 'GetComponentState', 'RenderModelHasComponent',
  'GetRenderModelThumbnailURL', 'GetRenderModelOriginalPath', 'GetRenderModelErrorNameFromEnum',
] as const;
