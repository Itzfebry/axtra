/**
 * Curated tech-stack catalog used for autocomplete and logo rendering.
 *
 * `slug` is a Simple Icons slug (https://simpleicons.org); logos are loaded
 * from the Simple Icons CDN. Entries without a matching icon simply render as
 * plain text chips.
 */
export type TechStackItem = {
  name: string;
  slug: string;
  keywords?: string[];
  /** Optional absolute logo URL override (e.g. a colored, multi-tone mark). */
  logo?: string;
};

export const TECH_STACK: TechStackItem[] = [
  { name: "Next.js", slug: "nextdotjs", keywords: ["nextjs", "next"] },
  { name: "React", slug: "react", keywords: ["reactjs"] },
  { name: "React Native", slug: "react", keywords: ["rn"] },
  { name: "TypeScript", slug: "typescript", keywords: ["ts"] },
  { name: "JavaScript", slug: "javascript", keywords: ["js"] },
  {
    name: "Python",
    slug: "python",
    keywords: ["py", "python3"],
    // Official two-tone (blue + yellow) mark; Simple Icons only ships flat blue.
    logo: "https://cdn.jsdelivr.net/gh/devicons/devicon/icons/python/python-original.svg",
  },
  { name: "FastAPI", slug: "fastapi", keywords: ["fast api"] },
  { name: "Django", slug: "django" },
  { name: "Flask", slug: "flask" },
  { name: "Node.js", slug: "nodedotjs", keywords: ["node", "nodejs"] },
  { name: "Express", slug: "express", keywords: ["expressjs"] },
  { name: "NestJS", slug: "nestjs", keywords: ["nest"] },
  { name: "Tailwind CSS", slug: "tailwindcss", keywords: ["tailwind"] },
  { name: "Vue.js", slug: "vuedotjs", keywords: ["vue", "vuejs"] },
  { name: "Nuxt", slug: "nuxtdotjs", keywords: ["nuxtjs"] },
  { name: "Svelte", slug: "svelte", keywords: ["sveltekit"] },
  { name: "Angular", slug: "angular", keywords: ["angularjs"] },
  { name: "Vite", slug: "vite", keywords: ["vitejs"] },
  { name: "Webpack", slug: "webpack" },
  { name: "Supabase", slug: "supabase" },
  { name: "PostgreSQL", slug: "postgresql", keywords: ["postgres", "pg"] },
  { name: "MySQL", slug: "mysql" },
  { name: "SQLite", slug: "sqlite" },
  { name: "MongoDB", slug: "mongodb", keywords: ["mongo"] },
  { name: "Redis", slug: "redis" },
  { name: "Prisma", slug: "prisma" },
  { name: "GraphQL", slug: "graphql", keywords: ["gql"] },
  { name: "Go", slug: "go", keywords: ["golang"] },
  { name: "Rust", slug: "rust" },
  { name: "Java", slug: "openjdk" },
  { name: "Kotlin", slug: "kotlin" },
  { name: "Swift", slug: "swift" },
  { name: "PHP", slug: "php" },
  { name: "Laravel", slug: "laravel" },
  { name: "Flutter", slug: "flutter" },
  { name: "Docker", slug: "docker" },
  { name: "Kubernetes", slug: "kubernetes", keywords: ["k8s"] },
  { name: "Vercel", slug: "vercel" },
  { name: "Netlify", slug: "netlify" },
  { name: "AWS", slug: "amazonwebservices", keywords: ["amazon"] },
  { name: "Google Cloud", slug: "googlecloud", keywords: ["gcp"] },
  { name: "Firebase", slug: "firebase" },
  { name: "Git", slug: "git" },
  { name: "GitHub", slug: "github" },
  { name: "Figma", slug: "figma" },
  { name: "Jest", slug: "jest", keywords: ["jestjs"] },
  { name: "Playwright", slug: "playwright" },
  { name: "TensorFlow", slug: "tensorflow", keywords: ["tf"] },
  { name: "PyTorch", slug: "pytorch", keywords: ["torch"] },
  { name: "OpenCV", slug: "opencv", keywords: ["cv"] },
];

function normalize(value: string): string {
  return value.toLowerCase().replace(/[\s.\-_+]/g, "");
}

const byKey = new Map<string, TechStackItem>();
for (const item of TECH_STACK) {
  byKey.set(normalize(item.name), item);
  byKey.set(normalize(item.slug), item);
  for (const keyword of item.keywords ?? []) {
    if (!byKey.has(normalize(keyword))) byKey.set(normalize(keyword), item);
  }
}

export function findTechStack(name: string): TechStackItem | null {
  return byKey.get(normalize(name)) ?? null;
}

export function techStackLogo(name: string): string | null {
  const item = findTechStack(name);
  if (!item) return null;
  return item.logo ?? `https://cdn.simpleicons.org/${item.slug}`;
}

export function searchTechStack(query: string, limit = 8): TechStackItem[] {
  const needle = normalize(query);
  if (!needle) return [];
  const starts: TechStackItem[] = [];
  const contains: TechStackItem[] = [];
  for (const item of TECH_STACK) {
    const name = normalize(item.name);
    const slug = normalize(item.slug);
    const keywords = (item.keywords ?? []).map(normalize);
    if (name.startsWith(needle) || slug.startsWith(needle) || keywords.some((k) => k.startsWith(needle))) {
      starts.push(item);
    } else if (name.includes(needle) || keywords.some((k) => k.includes(needle))) {
      contains.push(item);
    }
  }
  return [...starts, ...contains].slice(0, limit);
}