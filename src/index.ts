import createClient from 'openapi-fetch';
import type { paths } from './api.d.ts';
import { Command } from 'commander';

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

const uploadSnapshot = async (
  imageBuffer: Buffer,
  token: string,
): Promise<boolean> => {
  try {
    const response = await fetch('https://connect.prusa3d.com/c/snapshot', {
      method: 'PUT',
      body: imageBuffer,
      headers: {
        'Content-Type': 'image/jpg',
        Token: token,
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

const updateCameraInfo = async (
  cameraPath: string,
  token: string,
  name?: string,
): Promise<boolean> => {
  try {
    const response = await client.PUT('/c/info', {
      body: {
        config: {
          name: name ?? 'Prusa Pi Camera',
          path: cameraPath,
          driver: 'V4L2',
          trigger_scheme: 'THIRTY_SEC',
          resolution: { width: 1920, height: 1080 },
        },
      } as any,
      headers: {
        Token: token,
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

const pushSnapshot = async (
  cameraPath: string,
  token: string,
): Promise<boolean> => {
  const image = await captureImage(cameraPath);
  if (!image) return false;
  return uploadSnapshot(image, token);
};

const cameras = await findUSBCameras();

if (cameras.length === 0) {
  console.error('[ERROR] No video devices found');
  process.exit(1);
}

console.log(`[INFO] Found ${cameras.length} camera(s):`);
cameras.forEach((cam, idx) => console.log(`  [${idx}] ${cam}`));

// Parse CLI with commander for token=cameraIndex mappings.
// Example:
//  bun run src/index.ts tokenA=0 tokenB=1 --interval 30
const program = new Command();
program
  .name('pi-prusa-cam')
  .argument('<mappings...>', 'token=camIdx mappings (e.g. abc123=0)')
  .option('-i, --interval <seconds>', 'upload interval in seconds', '30')
  .parse(process.argv);

const mappingArgs: string[] = program.args as string[];
const cliInterval = Math.max(1, parseInt(program.opts().interval, 10));

type CameraToken = { cameraPath: string; token: string; name?: string };
const cameraTokens: CameraToken[] = [];

if (mappingArgs.length === 0) {
  console.error(
    'Usage: pi-prusa-cam token=idx [token=idx ...] [--interval seconds]',
  );
  process.exit(1);
}

for (const ma of mappingArgs) {
  // Accept forms: token=idx  or token=idx:Name
  const [t, right] = ma.split('=');
  if (!t || right == null) {
    console.error(`[ERROR] Invalid mapping: ${ma}. Expected token=idx[:name]`);
    process.exit(1);
  }
  const parts = right.split(':');
  const idxStr = parts[0];
  const name = parts.slice(1).join(':') || undefined;
  const idx = parseInt(idxStr, 10);
  if (isNaN(idx) || idx < 0 || idx >= cameras.length) {
    console.error(`[ERROR] Invalid camera index in mapping: ${ma}`);
    process.exit(1);
  }
  if (t.length > 20) {
    console.error(
      `[ERROR] Token too long for mapping: ${ma}. Tokens must be 20 characters or fewer.`,
    );
    process.exit(1);
  }
  cameraTokens.push({ cameraPath: cameras[idx]!, token: t, name });
}

console.log('[INFO] Starting camera streams:');
cameraTokens.forEach((ct) =>
  console.log(`  ${ct.cameraPath} -> [token:${ct.token.slice(0, 6)}...]`),
);
console.log(`[INFO] Upload interval: ${cliInterval}s`);

// Initialize and start snapshot loops for each selected camera-token mapping
for (const { cameraPath: camPath, token: camToken, name } of cameraTokens) {
  // per-mapping name is used if provided
  await updateCameraInfo(camPath, camToken, name);
  console.log(`[INFO] Camera initialized: ${camPath}`);

  // Push initial snapshot
  await pushSnapshot(camPath, camToken);

  // Push snapshots at regular interval for this camera
  setInterval(async () => {
    const success = await pushSnapshot(camPath, camToken);
    const status = success ? '[OK]' : '[FAIL]';
    console.log(`${status} ${camPath} ${new Date().toISOString()}`);
  }, cliInterval * 1000);
}
