import type { GenerateAiPostsInput } from '../../shared/aiAgents'

/** Character targets and token budgets belong to the article-writing contract, not individual model IDs. */
export const AI_POST_LENGTH_PROFILES = {
  'Ngắn': { minChars:300, maxChars:500, outputTokensPerPost:1100 },
  'Trung bình': { minChars:650, maxChars:1000, outputTokensPerPost:2100 },
  'Dài': { minChars:1200, maxChars:2000, outputTokensPerPost:3600 }
} as const

const AI_POST_MAX_OUTPUT_TOKENS = 8192
const AI_POST_BATCH_OVERHEAD_TOKENS = 256

export function aiPostLengthProfile(length: string) {
  return AI_POST_LENGTH_PROFILES[length as keyof typeof AI_POST_LENGTH_PROFILES]
    ?? AI_POST_LENGTH_PROFILES['Trung bình']
}

/** Batch large requests so selecting "Dài" for many posts never silently reduces tokens per post. */
export function planAiPostRequests(postCount: number, length: string): { postCount:number; maxTokens:number }[] {
  if (!Number.isInteger(postCount) || postCount < 1 || postCount > 50) {
    throw new Error('Số lượng bài phải từ 1 đến 50.')
  }
  const {outputTokensPerPost} = aiPostLengthProfile(length)
  const maxPerBatch = Math.max(1,Math.floor((AI_POST_MAX_OUTPUT_TOKENS - AI_POST_BATCH_OVERHEAD_TOKENS) / outputTokensPerPost))
  const plan: {postCount:number; maxTokens:number}[] = []
  for (let remaining=postCount;remaining>0;) {
    const count = Math.min(remaining,maxPerBatch)
    plan.push({postCount:count,maxTokens:Math.min(AI_POST_MAX_OUTPUT_TOKENS,
      AI_POST_BATCH_OVERHEAD_TOKENS + count * outputTokensPerPost)})
    remaining -= count
  }
  return plan
}

interface LayoutRecipe {
  name: string
  guidance: string
}

const MIXED_LAYOUT = 'Trộn bố cục'
const LAYOUT_RECIPES: readonly LayoutRecipe[] = [
  {
    name: 'Hook → Ý chính → CTA',
    guidance: 'Mở bằng 1 câu hook; triển khai các ý chính thành nhiều đoạn tương ứng với độ dài đã chọn; CTA tách riêng ở cuối.'
  },
  {
    name: 'Vấn đề → Giải pháp → Liên hệ',
    guidance: 'Nêu vấn đề rõ ràng; triển khai các giải pháp và lợi ích có căn cứ thành các đoạn riêng; thông tin liên hệ tách riêng.'
  },
  {
    name: 'Hook → Bullet → CTA',
    guidance: 'Mở bằng 1 câu hook; mỗi bullet trình bày một ý có đủ chi tiết theo độ dài đã chọn; CTA tách riêng.'
  },
  {
    name: 'Hỏi → Trả lời → Gợi ý',
    guidance: 'Mở bằng một câu hỏi; trả lời với số đoạn và độ chi tiết tương ứng độ dài đã chọn; thêm CTA nếu phù hợp.'
  },
  {
    name: 'Thông tin nhanh',
    guidance: 'Có thể có tiêu đề; trình bày thông tin theo từng dòng hoặc bullet rõ ràng, số ý phù hợp độ dài đã chọn; liên hệ để dòng riêng.'
  },
  {
    name: 'Chia sẻ tự nhiên',
    guidance: 'Không bắt buộc tiêu đề; chia thành các đoạn tự nhiên, mỗi đoạn một ý; số đoạn theo độ dài đã chọn; CTA ở cuối nếu cần.'
  }
] as const

const LEGACY_LAYOUT_ALIASES: Record<string, string> = {
  'Hook → Nội dung → CTA': 'Hook → Ý chính → CTA',
  'Vấn đề → Giải pháp → CTA': 'Vấn đề → Giải pháp → Liên hệ',
  'Thông tin → Lợi ích → CTA': 'Thông tin nhanh',
  'Tự do': 'Chia sẻ tự nhiên'
}

const READABILITY_RULES = [
  'QUY TẮC TRÌNH BÀY BẮT BUỘC:',
  '- Tuyệt đối không viết toàn bộ bài thành một khối văn dài (wall of text).',
  '- Mỗi đoạn tối đa 3 câu; ưu tiên 1–2 câu. Ý mới phải xuống đoạn hoặc xuống dòng.',
  '- CTA hoặc thông tin liên hệ, nếu có, phải tách thành đoạn riêng ở cuối bài.',
  '- Nếu dùng bullet/checklist, mỗi ý một dòng; không nhét nhiều ý vào cùng một bullet.',
  '- Không bắt buộc bài nào cũng có tiêu đề. Chỉ dùng tiêu đề khi đúng với bố cục đã chọn.'
] as const

const FACT_STYLE_RULES = [
  'QUY TẮC FACT VÀ GIỌNG VIẾT:',
  '- Không tự nhận đã trải nghiệm thực tế, review thực tế hoặc là chuyên gia nếu nguồn không cung cấp fact đó.',
  '- Không tự thêm các khẳng định như “hàng đầu”, “được nhiều khách hàng tin chọn”, “uy tín vững chắc” hoặc tương tự nếu nguồn không nói vậy.',
  '- Không tự bịa giá, địa chỉ, ưu đãi, thông số, nguồn gốc, mức độ phổ biến hoặc cam kết.'
] as const


function cleanPost(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\|/g, '｜') : ''
}

export function parseAiPostOutput(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []

  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (Array.isArray(parsed)) return parsed.map(cleanPost).filter(Boolean)
    if (parsed && typeof parsed === 'object') {
      const posts = (parsed as { posts?: unknown }).posts
      if (Array.isArray(posts)) return posts.map(cleanPost).filter(Boolean)
      const output = (parsed as { output?: unknown }).output
      if (typeof output === 'string') return parseAiPostOutput(output)
    }
  } catch {
    // Plain Agent output is expected for most Agent Builder deployments.
  }

  return trimmed
    .split(/\r?\n\s*\|\s*\r?\n/g)
    .map(cleanPost)
    .filter(Boolean)
}

function extraFieldLines(values: GenerateAiPostsInput['extraFields']): string[] {
  return Object.entries(values).flatMap(([key, value]) => {
    if (typeof value === 'string' && !value.trim()) return []
    return [`- ${key}: ${String(value)}`]
  })
}

function layoutRecipe(name: string): LayoutRecipe {
  const normalized = LEGACY_LAYOUT_ALIASES[name] ?? name
  return LAYOUT_RECIPES.find((recipe) => recipe.name === normalized) ?? LAYOUT_RECIPES[0]!
}

function mixedLayoutNames(postCount: number): string[] {
  const assigned: string[] = []
  let pool: string[] = []

  while (assigned.length < postCount) {
    if (!pool.length) pool = LAYOUT_RECIPES.map((recipe) => recipe.name)
    const index = Math.floor(Math.random() * pool.length)
    assigned.push(pool.splice(index, 1)[0]!)
  }

  return assigned
}

function layoutPlanLines(input: GenerateAiPostsInput): string[] {
  if (input.structure.trim() !== MIXED_LAYOUT) {
    const recipe = layoutRecipe(input.structure.trim())
    return [
      'MẠCH BÀI BẮT BUỘC:',
      `- ${recipe.name}: ${recipe.guidance}`
    ]
  }

  const assigned = mixedLayoutNames(input.postCount)
  const usedRecipes = [...new Set(assigned)].map(layoutRecipe)
  return [
    'BỐ CỤC TỪNG BÀI — Page-Auto đã chọn trước, không tự đổi:',
    ...assigned.map((name, index) => `- Bài ${index + 1}: ${name}.`),
    '',
    'HƯỚNG DẪN CÁC BỐ CỤC ĐƯỢC DÙNG:',
    ...usedRecipes.map((recipe) => `- ${recipe.name}: ${recipe.guidance}`)
  ]
}

export function buildAiPostPrompt(input: GenerateAiPostsInput): string {
  const profile = aiPostLengthProfile(input.length)
  const common = [
    `Số lượng: ${input.postCount} bài.`,
    `Loại bài: ${input.postType}.`,
    `Giọng văn: ${input.tone}.`,
    `Kiểu bố cục: ${input.structure}.`,
    `Độ dài: ${input.length}.`,
    'ĐỘ DÀI TỪNG BÀI — yêu cầu bắt buộc, không chỉ là nhãn mô tả:',
    `- Mỗi bài khoảng ${profile.minChars}–${profile.maxChars} ký tự tiếng Việt, tính cả dấu cách và xuống dòng (không tính dòng phân tách |).`,
    '- Không viết dạng tóm tắt quá ngắn khi đã chọn Trung bình hoặc Dài.',
    '- Triển khai nhiều đoạn với thông tin, cách sử dụng và lợi ích có cơ sở từ nguồn; tránh lặp ý để đủ độ dài.',
    '- Nếu nguồn không đủ dữ kiện, diễn giải những dữ kiện đã có; tuyệt đối không bịa thêm tính năng, thành tích, ưu đãi hay số liệu.',
    `Emoji: ${input.emoji ? 'có, dùng nhẹ' : 'không'}.`,
    `Hashtag: ${input.hashtag ? 'có, dùng vừa phải' : 'không'}.`,
    ...layoutPlanLines(input),
    ...READABILITY_RULES,
    ...FACT_STYLE_RULES
  ]

  const task = input.action === 'random'
    ? [
        'NHIỆM VỤ PAGE-AUTO: tạo các biến thể mới từ nội dung nguồn.',
        ...common,
        'Giữ đúng fact của nguồn. Có thể thay cách mở bài, nhịp trình bày và góc diễn đạt nhưng không được đổi dữ kiện.',
        'NỘI DUNG NGUỒN:',
        ...input.randomSourcePosts.map((post, index) => `[Nguồn ${index + 1}]\n${post}`)
      ]
    : [
        'NHIỆM VỤ PAGE-AUTO: viết bài mới từ thông tin người dùng cung cấp.',
        ...common,
        `Sản phẩm / chủ đề: ${input.subject.trim()}`,
        `Thông tin chính:\n${input.sourceInfo.trim()}`,
        input.highlight.trim() ? `Điểm cần nhấn mạnh: ${input.highlight.trim()}` : '',
        input.audience.trim() ? `Đối tượng: ${input.audience.trim()}` : '',
        ...extraFieldLines(input.extraFields),
        'Chỉ dùng fact đã được cung cấp. Nếu thiếu fact quan trọng, không tự bịa.'
      ]

  return [
    ...task.filter(Boolean),
    '',
    'ĐỊNH DẠNG ĐẦU RA BẮT BUỘC:',
    `- Trả đúng ${input.postCount} bài.`,
    '- Giữa hai bài đặt đúng một dòng chỉ có ký tự |.',
    '- Không dùng ký tự | bên trong nội dung từng bài.',
    '- Không thêm lời giải thích, tiêu đề kỹ thuật, markdown fence hay dữ liệu ngoài các bài.'
  ].join('\n')
}

