import { useLingui } from '@lingui/react/macro';
import { useEffect, useMemo, useRef } from 'preact/hooks';

import CharCountMeter from './char-count-meter';
import Icon from './icon';

// Segment character count under the strictest active network's rules:
// when any Bluesky target is active, Bluesky's literal-text counting wins.
function segmentCharCount(text, { blueskyRules }, stringLength, countableText) {
  return stringLength(blueskyRules ? text : countableText(text));
}

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
  countableText,
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

    try {
      const processedFiles = await processFiles(
        Array.from(files),
        segment.mediaAttachments.length,
      );
      if (processedFiles) {
        onChange({
          mediaAttachments: [
            ...segment.mediaAttachments,
            ...processedFiles,
          ].slice(0, maxMediaAttachments),
        });
      }
    } catch (err) {
      alert(t`Error processing files: ${err.message}`);
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
    countableText,
  );
  const mediaCanAdd =
    !maxMediaAttachments ||
    segment.mediaAttachments.length < maxMediaAttachments;

  // Build URL for media preview
  const mediaPreviewUrls = useMemo(() => {
    return segment.mediaAttachments.map((attachment) => {
      // Prioritize existing URL (from processFiles or server)
      if (attachment.url) {
        return attachment.url;
      }
      // Fallback to creating blob URL from fileData
      if (attachment.fileData) {
        const blob = new Blob([attachment.fileData], { type: attachment.type });
        return URL.createObjectURL(blob);
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
