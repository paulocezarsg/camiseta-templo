/* Funções compartilhadas pelas rotas da API (arquivos com "_" não viram rota na Vercel). */
import { scryptSync, timingSafeEqual } from "node:crypto";

/* Confere uma senha contra o hash scrypt ("sal:hash" em base64); a senha em si nunca vai para a página.
   Se a variável de ambiente indicada estiver definida, ela vale no lugar do hash (para trocar sem mexer no código). */
export function confereSenha(senha, hashGuardado, nomeVariavel) {
  const s = String(senha || "");
  const env = nomeVariavel && process.env[nomeVariavel];
  if (env) {
    const a = Buffer.from(s), b = Buffer.from(env);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  const [sal, hash] = hashGuardado.split(":").map((x) => Buffer.from(x, "base64"));
  const calc = scryptSync(s.normalize("NFKC"), sal, hash.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(calc, hash);
}

export class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}
/* Texto do erro para o log, sem segredos: um erro de cabeçalho inválido, por exemplo, traz o token inteiro
   na mensagem. Some o que vem depois de "Bearer" e qualquer sequência longa com cara de chave. */
export const semSegredos = (e) => String(e?.stack || e?.message || e)
  .replace(/Bearer\s+\S+/gi, "Bearer [oculto]")
  .replace(/[A-Za-z0-9_+/=-]{32,}/g, "[oculto]");
export function handle(fn) {
  return async (req) => {
    try { return await fn(req); }
    catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, ...(e.extra || {}) }, e.status);
      console.error(semSegredos(e));
      return json({ error: "Erro interno. Tente de novo em instantes." }, 500);
    }
  };
}
/* Cada rota exporta default { fetch }: o formato das Vercel Functions com Request/Response da Web.
   métodos: { GET, POST, ... }; qualquer outro método recebe 405. */
export function rota(metodos) {
  const tratadores = Object.fromEntries(Object.entries(metodos).map(([m, fn]) => [m, handle(fn)]));
  return {
    fetch(req) {
      const fn = tratadores[req.method];
      return fn ? fn(req) : new Response(null, { status: 405, headers: { Allow: Object.keys(tratadores).join(", ") } });
    },
  };
}
export async function readJSON(req, max = 50_000) {
  const text = await req.text();
  if (text.length > max) throw new HttpError(413, "Os dados enviados são grandes demais.");
  try { return JSON.parse(text || "{}"); }
  catch { throw new HttpError(400, "Dados inválidos."); }
}

export const digitos = (s) => String(s == null ? "" : s).replace(/\D/g, "");
export const linha = (s, n) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
export const UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

export function cpfValido(v) {
  const c = digitos(v);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  for (const n of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(c[i]) * (n + 1 - i);
    if (((soma * 10) % 11) % 10 !== Number(c[n])) return false;
  }
  return true;
}

/* ===================== banco de dados (Upstash Redis, via REST) ===================== */
/* Ao conectar o Upstash pela Vercel, as variáveis podem vir com um prefixo escolhido na tela
   (ex.: STORAGE_KV_REST_API_URL); por isso vale o nome exato ou qualquer um que termine assim. */
function variavel(...nomes) {
  for (const n of nomes) {
    if (process.env[n]) return process.env[n];
    const k = Object.keys(process.env).find((k) => k.endsWith("_" + n) && process.env[k]);
    if (k) return process.env[k];
  }
  return "";
}
const redisEnv = () => ({
  url: variavel("KV_REST_API_URL", "UPSTASH_REDIS_REST_URL"),
  token: variavel("KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_TOKEN"),
});
export const bancoPronto = () => { const e = redisEnv(); return !!(e.url && e.token); };

async function redisFetch(caminho, corpo) {
  const { url, token } = redisEnv();
  if (!url || !token) throw new HttpError(503, "O banco de dados ainda não foi configurado no servidor.");
  const r = await fetch(url.replace(/\/$/, "") + caminho, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(8000),
  });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d || d.error) throw new Error("Redis: " + ((d && d.error) || r.status));
  return d;
}
export async function redis(...cmd) { return (await redisFetch("", cmd)).result; }
/* Conta tentativas numa janela de tempo; devolve true enquanto estiver dentro do limite. */
export async function dentroDoLimite(chave, limite, janelaSeg) {
  const n = await redis("INCR", chave);
  if (n === 1) await redis("EXPIRE", chave, janelaSeg);
  return n <= limite;
}
export function ipDe(req) {
  return (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}

/* ===================== pedidos ===================== */
const chavePedido = (ref) => "cam:pedido:" + ref;
const LISTA = "cam:pedidos"; // conjunto ordenado: referência -> data de criação

export async function salvarPedido(p) {
  await redis("SET", chavePedido(p.ref), JSON.stringify(p));
  await redis("ZADD", LISTA, p.criadoEm, p.ref);
}
export async function lerPedido(ref) {
  const t = await redis("GET", chavePedido(ref));
  try { return t ? JSON.parse(t) : null; } catch { return null; }
}
export async function listarPedidos(max = 2000) {
  const refs = await redis("ZRANGE", LISTA, 0, max - 1, "REV");
  if (!refs?.length) return [];
  const textos = await redis("MGET", ...refs.map(chavePedido));
  return textos.map((t) => { try { return JSON.parse(t); } catch { return null; } }).filter(Boolean);
}
