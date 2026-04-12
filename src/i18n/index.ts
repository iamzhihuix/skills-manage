import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import zh from "./locales/zh.json";
import en from "./locales/en.json";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      zh: { translation: zh },
      en: { translation: en },
    },
    // No hardcoded lng — let languageDetector read from localStorage.
    // Falls back to Chinese when no preference is saved.
    fallbackLng: "zh",
    // Use localStorage key 'i18nextLng' (i18next default) to persist choice.
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "i18nextLng",
      caches: ["localStorage"],
    },
    interpolation: {
      escapeValue: false, // React already handles XSS escaping
    },
  });

export default i18n;
