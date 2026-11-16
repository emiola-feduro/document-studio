import type { MessageKey } from '../../../i18n';
import useT from '../../../hooks/ui/use-t';
import { FONT_CATEGORIES, FONTS, fontName } from '../../../lib/themes/fonts';
import usePreferencesStore from '../../../stores/use-preferences-store';

/** Monospaced fonts first, because they keep the code aligned. */
const ORDER = ['Monoespaciadas', ...FONT_CATEGORIES.filter((c) => c !== 'Monoespaciadas')] as const;

const SchemaViewFontSelect = () => {
  const t = useT();
  const codeFontId = usePreferencesStore((s) => s.codeFontId);
  const setCodeFont = usePreferencesStore((s) => s.setCodeFont);

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="code-font" className="text-muted">
        {t('schema.font')}
      </label>
      <select id="code-font" className="field field-sm w-auto" value={codeFontId} onChange={(e) => setCodeFont(e.target.value)}>
        {ORDER.map((category) => (
          <optgroup key={category} label={t(`fontCategory.${category}` as MessageKey)}>
            {FONTS.filter((f) => f.category === category).map((font) => (
              <option key={font.id} value={font.id}>
                {fontName(font, t)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
};

export default SchemaViewFontSelect;
