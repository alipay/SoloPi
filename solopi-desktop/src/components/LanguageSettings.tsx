import { useLanguage, type LanguagePreference } from '../language';

export default function LanguageSettings() {
  const { preference, setPreference, t } = useLanguage();

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-black text-slate-900">{t('语言', 'Language')}</h3>
      <div className="mt-5 grid max-w-sm gap-2">
        <label htmlFor="desktop-language" className="text-xs font-semibold text-slate-700">
          {t('界面语言', 'Display language')}
        </label>
        <select
          id="desktop-language"
          value={preference}
          onChange={(event) => setPreference(event.currentTarget.value as LanguagePreference)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
        >
          <option value="system">{t('跟随系统', 'Follow system')}</option>
          <option value="zh-CN" lang="zh-CN">简体中文</option>
          <option value="en" lang="en">English</option>
        </select>
      </div>
    </section>
  );
}
