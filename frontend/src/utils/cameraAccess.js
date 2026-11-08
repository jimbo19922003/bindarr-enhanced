export function assertCameraAllowed(doc) {
  const policy = doc?.permissionsPolicy || doc?.featurePolicy;
  if (typeof policy?.allowsFeature === 'function' && !policy.allowsFeature('camera')) {
    const error = new Error('Page permissions policy blocks the camera');
    error.name = 'CameraPolicyError';
    throw error;
  }
}

export function cameraFailureMessage(error) {
  switch (error?.name) {
    case 'CameraPolicyError':
      return 'This page blocks camera access through its permissions policy. If using an embedded Codespaces preview, open the forwarded app URL in its own browser tab and allow camera access there.';
    case 'CameraTimeoutError':
      return error.message || 'The browser camera request timed out. Check site and operating-system camera permissions.';
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera access was denied. Check camera permission for this site in Chrome and your operating system. If using an embedded Codespaces preview, open the forwarded app URL in its own browser tab.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No camera was found. Connect or enable a webcam, then retry.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The camera could not be started. Close other apps or tabs using it, check operating-system camera access, then retry.';
    case 'OverconstrainedError':
      return 'The selected camera cannot satisfy the requested settings. Choose an available camera or clear the saved camera choice, then retry.';
    case 'InsecureContextError':
      return 'Camera access requires a secure page. Open the app through HTTPS or localhost.';
    case 'UnsupportedCameraError':
      return 'Camera access is unavailable in this browser context. Open the app in a supported browser tab with camera access enabled.';
    default:
      return 'The camera could not be activated. Check site and operating-system camera permissions, then retry. See the browser console for technical details.';
  }
}
