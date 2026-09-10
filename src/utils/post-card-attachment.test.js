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

  it('falls back to image/png when the blob has no type', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])]);
    const attachment = await blobToAttachment(blob, 'alt', {
      createObjectURL: () => 'blob:fake-url',
    });
    expect(blob.type).toBe('');
    expect(attachment.type).toBe('image/png');
  });

  it('uses URL.createObjectURL when no factory is injected', async () => {
    const blob = new Blob([new Uint8Array([1])], { type: 'image/png' });
    const original = URL.createObjectURL;
    URL.createObjectURL = (b) => {
      expect(b).toBe(blob);
      return 'blob:default-url';
    };
    try {
      const attachment = await blobToAttachment(blob, 'alt');
      expect(attachment.url).toBe('blob:default-url');
    } finally {
      URL.createObjectURL = original;
    }
  });
});
