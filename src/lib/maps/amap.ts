// 大川机床 CRM —— 地图引擎加载器
// 说明：本文件原为高德(AMap)加载器，现已改为加载 Leaflet + 天地图底图。
// 为了不改动其它引用此文件的代码，文件名与导出名保持不变（loadLeaflet 为新增）。
// Leaflet 的 js/css 已放在 public/vendor/leaflet/ 下，由本站同源加载，
// 不依赖任何外部 CDN，国内服务器访问最稳定。

declare global {
  interface Window {
    L?: any;
    __dachuanLeafletLoader?: Promise<any>;
  }
}

const LEAFLET_JS = "/vendor/leaflet/leaflet.js";
const LEAFLET_CSS = "/vendor/leaflet/leaflet.css";

function ensureStylesheet() {
  if (document.querySelector('link[data-dachuan-leaflet="true"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = LEAFLET_CSS;
  link.dataset.dachuanLeaflet = "true";
  document.head.appendChild(link);
}

function waitForLeafletReady(timeoutMs = 15000) {
  return new Promise<any>((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      if (window.L?.map) {
        resolve(window.L);
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error("Leaflet 脚本已加载，但未就绪，请检查 /vendor/leaflet/leaflet.js 是否能正常访问。"));
        return;
      }
      window.setTimeout(check, 60);
    };
    check();
  });
}

export function loadLeaflet() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("地图只能在浏览器中加载"));
  }

  if (window.L?.map) {
    ensureStylesheet();
    return Promise.resolve(window.L);
  }

  if (window.__dachuanLeafletLoader) {
    return window.__dachuanLeafletLoader;
  }

  window.__dachuanLeafletLoader = new Promise((resolve, reject) => {
    ensureStylesheet();

    const existed = document.querySelector<HTMLScriptElement>('script[data-dachuan-leaflet="true"]');
    const finish = () => {
      waitForLeafletReady()
        .then((L) => {
          console.info("[Dachuan CRM] Leaflet ready");
          resolve(L);
        })
        .catch((error) => {
          window.__dachuanLeafletLoader = undefined;
          reject(error);
        });
    };

    if (existed) {
      if (window.L?.map) {
        finish();
      } else {
        existed.addEventListener("load", finish, { once: true });
        existed.addEventListener(
          "error",
          () => {
            window.__dachuanLeafletLoader = undefined;
            reject(new Error("Leaflet 脚本加载失败，请检查 public/vendor/leaflet/leaflet.js 是否随包部署。"));
          },
          { once: true }
        );
      }
      return;
    }

    const script = document.createElement("script");
    script.src = LEAFLET_JS;
    script.async = true;
    script.dataset.dachuanLeaflet = "true";
    script.onload = finish;
    script.onerror = () => {
      window.__dachuanLeafletLoader = undefined;
      reject(new Error("Leaflet 脚本加载失败，请检查 public/vendor/leaflet/leaflet.js 是否随包部署。"));
    };
    document.head.appendChild(script);
  });

  return window.__dachuanLeafletLoader;
}

// 兼容旧引用名（如有），统一指向 loadLeaflet
export const loadAmap = loadLeaflet;
