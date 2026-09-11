/**
 * Share-sheet delivery for an exported file.
 *
 * The only module that touches `expo-file-system` / `expo-sharing`. Files are
 * written to the cache directory: they are transient by design (the user shares
 * them out of the app), and the system may reclaim them.
 */

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { err, ok, type Result } from '../../core/result/result';
import { toolError } from '../../core/result/toolError';
import type { ExportFile } from './codecs';

/**
 * Write the export to the cache and open the system share sheet.
 *
 * Returns `CAPABILITY_UNAVAILABLE` when the platform has no share sheet (the
 * app still works — export is a bonus, not a dependency).
 */
export async function shareExport(file: ExportFile): Promise<Result<string>> {
  try {
    if (!(await Sharing.isAvailableAsync())) {
      return err(
        toolError('CAPABILITY_UNAVAILABLE', 'Sharing is not available on this device.', {
          technical: 'Sharing.isAvailableAsync() === false',
        }),
      );
    }

    const target = new File(Paths.cache, 'exports', file.filename);
    target.create({ intermediates: true, overwrite: true });
    target.write(file.contents);

    await Sharing.shareAsync(target.uri, {
      mimeType: file.mimeType,
      dialogTitle: file.filename,
    });
    return ok(target.uri);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err(
      toolError('NATIVE_ERROR', 'Could not open the share sheet.', {
        technical: `shareExport(${file.filename}) failed: ${detail}`,
        cause,
      }),
    );
  }
}
