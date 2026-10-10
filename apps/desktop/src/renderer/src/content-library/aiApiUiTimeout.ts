/** Renderer fallback if Electron IPC/Main fails to settle. Does not replace the Main network abort. */
export async function withAiApiUiTimeout<T>(operation: Promise<T>, timeoutMs = 30_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error('Đã hết thời gian chờ kiểm tra Model. Nút đã mở lại; thử model khác hoặc kiểm tra mạng.'))
    }, timeoutMs)
  })
  try {
    return await Promise.race([operation, deadline])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
