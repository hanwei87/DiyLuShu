/** 浏览器能力自检（十一轮反馈1：CatsXP等Chromium内核浏览器的兼容性说明） */

export function browserInfo() {
  const ua = navigator.userAgent;
  const m = /Chrome\/(\d+)/.exec(ua);
  return {
    isChromium: Boolean(m),
    chromeVersion: m ? Number(m[1]) : null,
    hasFSA: typeof window.showDirectoryPicker === 'function',
    hasGeo: 'geolocation' in navigator,
    isMobileUA: /Android|iPhone|iPad|Mobile/i.test(ua),
  };
}

/** 「我的」页兼容性行（不支持项附解决引导，十二轮反馈3） */
export function compatRows() {
  const b = browserInfo();
  return [
    { k: '浏览器内核', v: b.isChromium ? `Chromium ${b.chromeVersion}` : '非Chromium内核' },
    {
      k: '本地文件夹读写',
      v: b.hasFSA
        ? '✓ 支持'
        : (b.isChromium && b.chromeVersion >= 86
          ? `✗ 不支持（内核 ${b.chromeVersion} 本应支持——多半是浏览器关闭了该能力，见下方教程可尝试打开）`
          : '✗ 不支持 → 解决方法见下方「文件夹读写教程」'),
    },
    { k: '定位', v: b.hasGeo ? '✓ 支持（HTTPS 或 localhost 下可用）' : '✗ 不支持' },
    { k: '数据持久化', v: '已向浏览器申请持久化存储' },
  ];
}

/** 文件夹读写不支持时的傻瓜式教程（十二轮反馈3） */
export function fsaHelpHtml() {
  const b = browserInfo();
  const bad = !b.hasFSA;
  return `<details class="fsa-help" ${bad ? 'open' : ''}>
    <summary>📂 文件夹读写是什么？不支持怎么办？</summary>
    <div class="fsa-help-body">
      <p><strong>这是什么：</strong>允许网页把你的路书数据直接保存成电脑文件夹里的文件。不支持时，数据仍保存在浏览器内（已申请持久化，正常使用不会丢），只是少了"文件夹里可见的JSON文件"，且需手动导出备份。</p>
      <p><strong>解决办法（按顺序尝试）：</strong></p>
      <ol>
        <li>查看内核版本：在地址栏输入 <span class="kbd">chrome://version</span>（CatsXP等Chrome内核浏览器通用），确认版本 ≥ 86；</li>
        <li><strong>内核 ≥ 86 仍不支持</strong>（如 CatsXP 显示 153 却不支持）：多半是浏览器关闭了该能力——地址栏输入 <span class="kbd">chrome://flags/#file-system-access-api</span>，将其设为 <strong>Enabled</strong> 后点重启浏览器，再回来试；</li>
        <li>升级你的浏览器到官网最新版（CatsXP请到其官网下载最新安装包）；</li>
        <li>升级/开启后仍不行：改用 <strong>Chrome</strong> 或 <strong>Edge</strong> 打开本页地址（数据可用「导出/导入备份」迁移）；</li>
        <li>都不方便：继续用当前浏览器也没问题——数据已申请持久化存储不会丢，记得偶尔点「导出全部数据」备份。</li>
      </ol>
    </div>
  </details>`;
}

/** 启动时申请持久化存储（镜像数据在无文件夹授权时更不容易被清理） */
export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch { /* 忽略 */ }
}
