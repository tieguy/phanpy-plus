import { useLingui } from '@lingui/react/macro';
import { useEffect, useMemo, useRef } from 'preact/hooks';

import { segmentCharCount } from '../utils/compose-counting';

import CharCountMeter from './char-count-meter';
import Icon from './icon';

function ThreadSegmentEditor({
  segment,
  maxCharacters,
  blueskyRules,
  maxMediaAttachments,
  disabled,
  onChange,
  onRemove,
  processFiles,
  stringLength,
}) {
  const { t } = useLingui();
  const fileInputRef = useRef();

  const handleTextChange = (e) => {
    onChange({ text: e.target.value });
  };

  const handleAddMedia = async () => {
    if (!fileInputRef.current) return;

    const files = fileInputRef.current.files;
    if (!files?.length) return;

    // Reset input to allow same file selection
    const currentInput = fileInputRef.current;

    let processedFiles;
    try {
      processedFiles = await processFiles(
        Array.from(files),
        segment.mediaAttachments.length,
      );
    } catch (err) {
      alert(t`Error processing files: ${err?.message || err}`);
      currentInput.value = '';
      return;
    }

    if (processedFiles) {
      onChange({
        mediaAttachments: [
          ...segment.mediaAttachments,
          ...processedFiles,
        ].slice(0, maxMediaAttachments),
      });
    }

    currentInput.value = '';
  };

  const handleRemoveMedia = (indexToRemove) => {
    onChange({
      mediaAttachments: segment.mediaAttachments.filter(
        (_, i) => i !== indexToRemove,
      ),
    });
  };

  const charCount = segmentCharCount(
    segment.text,
    { blueskyRules },
    stringLength,
  );
  const mediaCanAdd =
    !maxMediaAttachments ||
    segment.mediaAttachments.length < maxMediaAttachments;

  // Build URL for media preview
  // Prioritize fileData so restored drafts get a fresh blob URL
  const mediaPreviewUrls = useMemo(() => {
    return segment.mediaAttachments.map((attachment) => {
      // Prioritize fileData for restored drafts
      if (attachment.fileData) {
        const blob = new Blob([attachment.fileData], { type: attachment.type });
        return URL.createObjectURL(blob);
      }
      // Fallback to existing URL (from processFiles or server)
      if (attachment.url) {
        return attachment.url;
      }
      return null;
    });
  }, [segment.mediaAttachments]);

  // Cleanup blob URLs on unmount or when attachments change
  useEffect(() => {
    return () => {
      mediaPreviewUrls.forEach((url) => {
        if (url && !segment.mediaAttachments.some((a) => a.url === url)) {
          URL.revokeObjectURL(url);
        }
      });
    };
  }, [mediaPreviewUrls]);

  return (
    <div class="thread-segment">
      <textarea
        class="segment-textarea"
        placeholder={t`Continue your thread...`}
        value={segment.text}
        disabled={disabled}
        onInput={handleTextChange}
      />

      {segment.mediaAttachments?.length > 0 && (
        <div class="media-attachments segment-media">
          {segment.mediaAttachments.map((attachment, i) => {
            const previewUrl = mediaPreviewUrls[i];
            return (
              <div key={attachment.id || i} class="segment-media-item">
                <div class="media-preview">
                  {previewUrl && (
                    <img src={previewUrl} alt="" class="media-preview-img" />
                  )}
                </div>
                <button
                  type="button"
                  class="remove-media"
                  title={t`Remove`}
                  onClick={() => handleRemoveMedia(i)}
                >
                  <Icon icon="x" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div class="segment-controls">
        <button
          type="button"
          class="toolbar-button"
          disabled={disabled || !mediaCanAdd}
          onClick={() => fileInputRef.current?.click()}
          title={t`Add media`}
        >
          <Icon icon="attachment" alt={t`Add media`} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,video/*"
          hidden
          onChange={handleAddMedia}
        />

        <CharCountMeter maxCharacters={maxCharacters} charCount={charCount} />

        <button
          type="button"
          class="remove-segment"
          disabled={disabled}
          title={t`Remove this segment`}
          onClick={onRemove}
        >
          <Icon icon="x" />
        </button>
      </div>
    </div>
  );
}

export default ThreadSegmentEditor;
