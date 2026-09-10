import { describe, expect, it } from 'vitest';

import { blobToAttachment } from './post-card-attachment';

describe('blobToAttachment', () => {
  it('builds the composer attachment shape from a PNG blob', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const blob = new Blob([bytes], { type: 'image/png' });
    const createObjectURL = (b) => {
      expect(b).toBe(blob);
      return 'blob:fake-url';
    };

    const attachment = await blobToAttachment(blob, 'alt text here', {
      createObjectURL,
    });

    expect(attachment).toMatchObject({
      fileName: 'quoted-post.png',
      type: 'image/png',
      size: 4,
      url: 'blob:fake-url',
      id: null,
      description: 'alt text here',
    });
    expect(new Uint8Array(attachment.fileData)).toEqual(bytes);
  });
});
