/** 把"永远不返回"变成"超时失败" —— 原生桥接出问题时最怕的就是无声悬挂 */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>(function (resolve, reject) {
    let done = false;
    const timer = setTimeout(function () {
      if (done) return;
      done = true;
      reject(new Error(label + ' 超时（' + ms + 'ms 没有响应）'));
    }, ms);
    p.then(function (v) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(v);
    }, function (e) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(e);
    });
  });
}

export const CALL_TIMEOUT = 6000;
export const LOAD_TIMEOUT = 10000;
