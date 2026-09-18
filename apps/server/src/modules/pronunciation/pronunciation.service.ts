import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { EnvConfig } from '../../config/env.validation';

const execFileAsync = promisify(execFile);

/** child_process.execFile has no stdin-piping option (that's only on the
 * *Sync variants) — spawn + manually writing/ending stdin is the correct
 * way to feed Piper text over stdin while still capturing a clean exit. */
function runWithStdin(bin: string, args: string[], input: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `exited with code ${code}`));
    });
    child.stdin.write(input);
    child.stdin.end();
  });
}

/**
 * Offline speech pipeline (build plan "Speech (offline)": eSpeak-NG for
 * G2P->IPA, Piper for model-voice audio — no cloud speech API is possible
 * air-gapped). Neither binary is vendored into this repo (that's
 * infra/offline/'s job at deployment time); on a dev machine without them
 * installed, this degrades to a clear 503 rather than a stack trace deep
 * inside a spawn call — the same honesty pattern native-bridge uses for
 * its own platform-dependent gap (input-lock blocking with no C++
 * toolchain on the build machine).
 */
@Injectable()
export class PronunciationService {
  constructor(private readonly config: ConfigService<EnvConfig, true>) {}

  isConfigured(): { ipa: boolean; voice: boolean } {
    return {
      ipa: Boolean(this.config.get('ESPEAK_NG_BIN', { infer: true })),
      voice: Boolean(this.config.get('PIPER_BIN', { infer: true }) && this.config.get('PIPER_VOICES_DIR', { infer: true })),
    };
  }

  /** Build the env for eSpeak-NG child process. When the binary is run from
   * a portable (non-installed) extraction, it needs ESPEAK_DATA_PATH set to
   * the espeak-ng-data folder alongside the exe; without it the binary
   * crashes with an access violation looking for the data in its compiled-in
   * default path (C:\\Program Files\\eSpeak NG\\espeak-ng-data). */
  private espeakEnv(): NodeJS.ProcessEnv | undefined {
    const dataPath = this.config.get('ESPEAK_NG_DATA', { infer: true });
    if (!dataPath) return undefined;
    return { ...process.env, ESPEAK_DATA_PATH: dataPath };
  }

  /** Grapheme-to-phoneme via eSpeak-NG, `--ipa` output. */
  async generateIpa(text: string): Promise<string> {
    const bin = this.config.get('ESPEAK_NG_BIN', { infer: true });
    if (!bin) {
      throw new ServiceUnavailableException(
        'eSpeak-NG is not configured (ESPEAK_NG_BIN) — pronunciation exercises can still record/play back, just without generated IPA',
      );
    }
    try {
      const { stdout } = await execFileAsync(bin, ['-q', '--ipa', '-x', text], {
        timeout: 10_000,
        env: this.espeakEnv(),
      });
      return stdout.trim();
    } catch (err) {
      throw new ServiceUnavailableException(`eSpeak-NG failed: ${(err as Error).message}`);
    }
  }

  /** Model-voice audio via Piper. Voice files follow Piper's standard
   * release layout: `<voice>.onnx` + `<voice>.onnx.json` in PIPER_VOICES_DIR. */
  async generateModelAudio(text: string, voice: 'en_US' | 'en_GB'): Promise<Buffer> {
    const bin = this.config.get('PIPER_BIN', { infer: true });
    const voicesDir = this.config.get('PIPER_VOICES_DIR', { infer: true });
    if (!bin || !voicesDir) {
      throw new ServiceUnavailableException(
        'Piper is not configured (PIPER_BIN/PIPER_VOICES_DIR) — pronunciation exercises can still record/play back, just without generated model audio',
      );
    }
    const modelPath = path.join(voicesDir, `${voice}.onnx`);
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'piper-'));
    const outPath = path.join(tempDir, 'out.wav');
    try {
      await runWithStdin(bin, ['--model', modelPath, '--output_file', outPath], text, 20_000);
      return await readFile(outPath);
    } catch (err) {
      throw new ServiceUnavailableException(`Piper failed: ${(err as Error).message}`);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}
