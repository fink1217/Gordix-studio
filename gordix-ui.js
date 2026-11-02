/* 僅同步共用導覽與頁面語系，不介入各工具的操作事件。 */
(function () {
    'use strict';
    /** 沿用既有語系偏好，同時提供正確的輔助閱讀語言。 */
    function syncLanguage() {
        let language = 'zh';
        try { language = localStorage.getItem('gordix-lang') || 'zh'; } catch (_) { }
        document.documentElement.lang = language === 'en' ? 'en' : 'zh-TW';
    }
    document.addEventListener('DOMContentLoaded', syncLanguage);
    window.addEventListener('load', syncLanguage);
    window.addEventListener('storage', event => {
        if (event.key === 'gordix-lang') syncLanguage();
    });
    document.addEventListener('click', event => {
        if (event.target.closest('#lang-toggle, #langBtn, [onclick*="toggleLang"]')) {
            queueMicrotask(syncLanguage);
        }
    });
})();
