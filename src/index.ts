import createClient from 'openapi-fetch';
import type { paths } from './api.d.ts';

const token = Bun.argv[2];
const cameraIndexArg = Bun.argv[3];
const intervalArg = Bun.argv[4];

if (!token) {
  console.error(
    'Usage: bun run index.ts <token> [camera-index] [interval-seconds]',
  );
  process.exit(1);
}

const interval = intervalArg ? Math.max(1, parseInt(intervalArg, 10)) : 30;

const client = createClient<paths>({
  baseUrl: 'https://connect.prusa3d.com',
});

const findUSBCameras = async (): Promise<string[]> => {
  const proc = Bun.spawn(
    ['sh', '-c', 'ls -1 /dev/video* 2>/dev/null || true'],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const output = await new Response(proc.stdout).text();
  return output
    .trim()
    .split('\n')
    .filter((d) => d);
};

const captureImage = async (devicePath: string): Promise<Buffer | null> => {
  try {
    const proc = Bun.spawn(
      [
        'ffmpeg',
        '-f',
        'v4l2',
        '-input_format',
        'mjpeg',
        '-i',
        devicePath,
        '-vframes',
        '1',
        '-q:v',
        '5',
        '-f',
        'image2',
        '-c:v',
        'mjpeg',
        'pipe:1',
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    const output = await new Response(proc.stdout).arrayBuffer();
    return Buffer.from(output);
  } catch (error) {
    console.error(`[ERROR] Failed to capture from ${devicePath}:`, error);
    return null;
  }
};

const uploadSnapshot = async (imageBuffer: Buffer): Promise<boolean> => {
  try {
    const response = await fetch('https://connect.prusa3d.com/c/snapshot', {
      method: 'PUT',
      body: imageBuffer,
      headers: {
        'Content-Type': 'image/jpg',
        Token: token!,
        Fingerprint: 'pi-prusa-cam-device',
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.error(`[ERROR] Upload failed (${response.status}):`, error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('[ERROR] Upload failed:', error);
    return false;
  }
};

const updateCameraInfo = async (cameraPath: string): Promise<boolean> => {
  try {
    const response = await client.PUT('/c/info', {
      body: {
        config: {
          name: 'Prusa Pi Camera',
          path: cameraPath,
          driver: 'V4L2',
          trigger_scheme: 'THIRTY_SEC',
          resolution: { width: 1920, height: 1080 },
        },
      } as any,
      headers: {
        Token: token!,
        Fingerprint: 'pi-prusa-cam-device',
      },
    });

    if (response.error) {
      console.error('[ERROR] Failed to update camera info:', response.error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('[ERROR] Failed to update camera info:', error);
    return false;
  }
};

const pushSnapshot = async (cameraPath: string): Promise<boolean> => {
  const image = await captureImage(cameraPath);
  if (!image) return false;
  return uploadSnapshot(image);
};

const cameras = await findUSBCameras();

if (cameras.length === 0) {
  console.error('[ERROR] No video devices found');
  process.exit(1);
}

console.log(`[INFO] Found ${cameras.length} camera(s):`);
cameras.forEach((cam, idx) => console.log(`  [${idx}] ${cam}`));

let cameraPath: string;

if (cameraIndexArg) {
  const idx = parseInt(cameraIndexArg, 10);
  if (isNaN(idx) || idx < 0 || idx >= cameras.length) {
    console.error(`[ERROR] Invalid camera index: ${cameraIndexArg}`);
    process.exit(1);
  }
  cameraPath = cameras[idx]!;
} else {
  cameraPath = cameras[0]!;
}

console.log(`[INFO] Using camera: ${cameraPath}`);
console.log(`[INFO] Upload interval: ${interval}s`);

await updateCameraInfo(cameraPath);
console.log('[INFO] Camera initialized');

// Push initial snapshot
await pushSnapshot(cameraPath);

// Push snapshots at regular interval
setInterval(async () => {
  const success = await pushSnapshot(cameraPath);
  const status = success ? '[OK]' : '[FAIL]';
  console.log(`${status} ${new Date().toISOString()}`);
}, interval * 1000);
