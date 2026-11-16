import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';

export function DeviceSerialSelect({ value, options, onChange, disabled = false, placeholder = '未检测到设备' }: {
  value: string; options: { value: string; label: string }[]; onChange: (value: string) => void; disabled?: boolean; placeholder?: string;
}) {
  return <div className="relative group min-w-0 flex-1">
    <select aria-label="设备序列号" title={options.find(option => option.value === value)?.label || placeholder} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} className="w-full h-8 bg-secondary/50 border border-border/50 rounded-xl pl-3 pr-7 text-[12px] appearance-none cursor-pointer focus:outline-none focus:ring-1 ring-primary/30 truncate">
      {(!value || options.length === 0) && <option value="">{placeholder}</option>}
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    <ChevronDown className="w-3 h-3 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none group-hover:text-foreground transition-colors" />
  </div>;
}

export function PackageSelect({ selectedPackage, packageOptions, onPackageChange, packageListId, disabled = false, placeholder = '搜索包名', labels }: {
  selectedPackage: string; packageOptions: string[]; onPackageChange: (value: string) => void; packageListId: string; disabled?: boolean; placeholder?: string; labels?: Record<string, string>;
}) {

  const packageInputRef = useRef<HTMLInputElement>(null);
  const [packageQuery, setPackageQuery] = useState(selectedPackage);
  const [isPackageMenuOpen, setIsPackageMenuOpen] = useState(false);
  const [highlightedPackageIndex, setHighlightedPackageIndex] = useState(0);
  const filteredPackageOptions = useMemo(() => {
    const normalizedQuery = packageQuery.trim().toLowerCase();
    if (!normalizedQuery) return packageOptions;
    return packageOptions.filter((packageName) => packageName.toLowerCase().includes(normalizedQuery));
  }, [packageOptions, packageQuery]);

  useEffect(() => {
    setPackageQuery(selectedPackage);
  }, [selectedPackage]);

  useEffect(() => {
    setHighlightedPackageIndex((current) => Math.min(
      current,
      Math.max(0, filteredPackageOptions.length - 1)
    ));
  }, [filteredPackageOptions.length]);

  const selectPackage = (packageName: string) => {
    setPackageQuery(packageName);
    setIsPackageMenuOpen(false);
    setHighlightedPackageIndex(0);
    onPackageChange(packageName);
  };


  return (
          <div className="relative group">
            <input
              ref={packageInputRef}
              disabled={disabled}
              aria-label="应用包名"
              title={selectedPackage || placeholder}
              value={packageQuery}
              onChange={(event) => {
                setPackageQuery(event.target.value);
                setHighlightedPackageIndex(0);
                setIsPackageMenuOpen(true);
              }}
              onFocus={() => { setPackageQuery(''); setHighlightedPackageIndex(0); setIsPackageMenuOpen(true); }}
              onBlur={() => {
                setIsPackageMenuOpen(false);
                setPackageQuery(selectedPackage);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setIsPackageMenuOpen(true);
                  setHighlightedPackageIndex((current) => Math.min(
                    current + 1,
                    Math.max(0, filteredPackageOptions.length - 1)
                  ));
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setHighlightedPackageIndex((current) => Math.max(0, current - 1));
                }
                if (event.key === 'Enter' && isPackageMenuOpen && filteredPackageOptions[highlightedPackageIndex]) {
                  event.preventDefault();
                  selectPackage(filteredPackageOptions[highlightedPackageIndex]);
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setPackageQuery(selectedPackage);
                  setIsPackageMenuOpen(false);
                }
              }}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={isPackageMenuOpen}
              aria-controls={packageListId}
              aria-activedescendant={isPackageMenuOpen && filteredPackageOptions[highlightedPackageIndex]
                ? `${packageListId}-${highlightedPackageIndex}`
                : undefined}
              className="w-full h-8 bg-secondary/50 border border-border/50 rounded-xl pl-3 pr-14 text-[12px] focus:outline-none focus:ring-1 ring-primary/30 truncate"
              placeholder={placeholder}
            />
            <Search className="w-3.5 h-3.5 absolute right-8 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none group-hover:text-foreground transition-colors" />
            <button
              type="button"
              disabled={disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                packageInputRef.current?.focus();
                setPackageQuery('');
                setHighlightedPackageIndex(0);
                setIsPackageMenuOpen(true);
              }}
              className="nodrag absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-slate-100 hover:text-foreground"
              title="展开包名列表"
              aria-label="展开包名列表"
            >
              <ChevronDown className={`h-3 w-3 transition-transform ${isPackageMenuOpen ? 'rotate-180' : ''}`} />
            </button>
            {isPackageMenuOpen && !disabled && (
              <div
                id={packageListId}
                role="listbox"
                className="absolute left-0 right-0 top-[calc(100%+0.25rem)] z-30 max-h-52 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl shadow-slate-200/60"
              >
                {filteredPackageOptions.length > 0 ? (
                  filteredPackageOptions.map((packageName, index) => (
                    <button
                      id={`${packageListId}-${index}`}
                      key={packageName}
                      type="button"
                      role="option"
                      aria-selected={packageName === selectedPackage}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setHighlightedPackageIndex(index)}
                      onClick={() => selectPackage(packageName)}
                      className={`nodrag flex w-full items-center rounded-lg px-2.5 py-2 text-left text-[11px] font-medium transition-colors ${
                        index === highlightedPackageIndex
                          ? 'bg-blue-50 text-blue-700'
                          : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <span className="truncate font-mono">{labels?.[packageName] || packageName}</span>
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-4 text-center text-[11px] font-medium text-slate-400">
                    未找到匹配包名
                  </div>
                )}
              </div>
            )}
          </div>
  );
}
