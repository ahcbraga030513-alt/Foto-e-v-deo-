// Servidor do Foto em Vídeo (Cloudflare Worker).
// Guarda a chave da fal.ai em segredo, confere a senha e controla os créditos.
// Variáveis necessárias: FAL_KEY (secret), PASSCODE (secret), CREDITS (KV),
// ALLOWED_ORIGIN, DAILY_LIMIT, GLOBAL_DAILY_CAP.

const MODEL = "fal-ai/kling-video/v2.5-turbo/pro/image-to-video";

function today() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}
async function getInt(env, key) {
  const v = await env.CREDITS.get(key);
  return v ? parseInt(v, 10) || 0 : 0;
}
async function putInt(env, key, n) {
  await env.CREDITS.put(key, String(Math.max(0, n)), { expirationTtl: 172800 });
}

export default {
  async fetch(req, env) {
    const ch = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,X-Passcode,X-Device",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: ch });
    const reply = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { ...ch, "content-type": "application/json" } });

    try {
      if (!env.FAL_KEY || !env.PASSCODE || !env.CREDITS) {
        return reply({ error: "O servidor ainda não está configurado." }, 500);
      }
      if (req.headers.get("X-Passcode") !== env.PASSCODE) return reply({ error: "Senha incorreta." }, 401);
      const dev = req.headers.get("X-Device") || "";
      if (!/^[A-Za-z0-9-]{8,64}$/.test(dev)) return reply({ error: "Aparelho inválido." }, 400);

      const url = new URL(req.url);
      const day = today();
      const daily = parseInt(env.DAILY_LIMIT || "1000", 10);
      const cap = parseInt(env.GLOBAL_DAILY_CAP || "30", 10);
      const ck = "c:" + dev + ":" + day;
      const gk = "g:" + day;
      const falHeaders = { Authorization: "Key " + env.FAL_KEY, "Content-Type": "application/json" };

      async function refund(job) {
        if (!job || job.refunded) return;
        job.refunded = true;
        await env.CREDITS.put("j:" + job.id, JSON.stringify(job), { expirationTtl: 86400 });
        await putInt(env, "c:" + job.device + ":" + job.day, (await getInt(env, "c:" + job.device + ":" + job.day)) - 1);
        await putInt(env, "g:" + job.day, (await getInt(env, "g:" + job.day)) - 1);
      }

      if (url.pathname === "/credits" && req.method === "GET") {
        const used = await getInt(env, ck);
        return reply({ left: Math.max(0, daily - used), daily });
      }

      if (url.pathname === "/generate" && req.method === "POST") {
        const body = await req.json().catch(() => null);
        if (!body) return reply({ error: "Pedido inválido." }, 400);
        const prompt = String(body.prompt || "").trim().slice(0, 500);
        const duration = body.duration === "10" ? "10" : "5";
        const image = String(body.image || "");
        if (!prompt) return reply({ error: "Escreva o que a foto deve fazer." }, 400);
        if (!/^data:image\/(jpeg|png|webp);base64,/.test(image) || image.length > 12000000) {
          return reply({ error: "Foto inválida ou grande demais." }, 400);
        }
        const used = await getInt(env, ck);
        if (used >= daily) return reply({ error: "Seus créditos de hoje acabaram. Volte amanhã." }, 429);
        const g = await getInt(env, gk);
        if (g >= cap) return reply({ error: "O limite diário de vídeos do servidor foi atingido. Volte amanhã." }, 429);

        await putInt(env, ck, used + 1);
        await putInt(env, gk, g + 1);

        const r = await fetch("https://queue.fal.run/" + MODEL, {
          method: "POST",
          headers: falHeaders,
          body: JSON.stringify({ prompt, image_url: image, duration }),
        });
        if (!r.ok) {
          const t = (await r.text()).slice(0, 200);
          await putInt(env, ck, (await getInt(env, ck)) - 1);
          await putInt(env, gk, (await getInt(env, gk)) - 1);
          return reply({ error: "O serviço de vídeo recusou o pedido.", detail: t }, 502);
        }
        const d = await r.json();
        const job = {
          id: d.request_id, device: dev, day, refunded: false,
          status_url: d.status_url, response_url: d.response_url, video_url: null,
        };
        await env.CREDITS.put("j:" + job.id, JSON.stringify(job), { expirationTtl: 86400 });
        return reply({ id: job.id, left: Math.max(0, daily - used - 1) });
      }

      const id = url.searchParams.get("id") || "";
      if (url.pathname === "/status" || url.pathname === "/video") {
        const raw = /^[A-Za-z0-9-]{8,64}$/.test(id) ? await env.CREDITS.get("j:" + id) : null;
        const job = raw ? JSON.parse(raw) : null;
        if (!job || job.device !== dev) return reply({ error: "Pedido não encontrado." }, 404);

        if (url.pathname === "/status") {
          if (job.video_url) return reply({ status: "COMPLETED" });
          const s = await fetch(job.status_url, { headers: falHeaders });
          if (!s.ok) return reply({ status: "IN_PROGRESS" });
          const sd = await s.json();
          if (sd.status !== "COMPLETED") return reply({ status: sd.status || "IN_PROGRESS", queue_position: sd.queue_position });
          const rr = await fetch(job.response_url, { headers: falHeaders });
          const rd = rr.ok ? await rr.json().catch(() => null) : null;
          const vurl = rd && rd.video && rd.video.url;
          if (!vurl) {
            await refund(job);
            return reply({ status: "FAILED", error: "O serviço não conseguiu criar o vídeo. O crédito foi devolvido." });
          }
          job.video_url = vurl;
          await env.CREDITS.put("j:" + job.id, JSON.stringify(job), { expirationTtl: 86400 });
          return reply({ status: "COMPLETED" });
        }

        if (!job.video_url) return reply({ error: "Vídeo ainda não está pronto." }, 409);
        const v = await fetch(job.video_url);
        if (!v.ok) return reply({ error: "Não consegui baixar o vídeo." }, 502);
        return new Response(v.body, { headers: { ...ch, "content-type": "video/mp4", "cache-control": "private, max-age=3600" } });
      }

      return reply({ error: "Rota não encontrada." }, 404);
    } catch (e) {
      return reply({ error: "Erro no servidor." }, 500);
    }
  },
};
