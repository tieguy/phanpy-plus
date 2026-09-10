// Wraps a rendered card Blob in the composer's media attachment shape (see
// processFiles in src/components/compose.jsx). Blob URL creation is
// injectable so this is testable in Node.

export const CARD_FILE_NAME = 'quoted-post.png';

export async function blobToAttachment(blob, altText, opts = {}) {
  const createObjectURL =
    opts.createObjectURL || ((b) => URL.createObjectURL(b));
  return {
    fileData: await blob.arrayBuffer(),
    fileName: CARD_FILE_NAME,
    type: blob.type || 'image/png',
    size: blob.size,
    url: createObjectURL(blob),
    id: null,
    description: altText,
  };
}
