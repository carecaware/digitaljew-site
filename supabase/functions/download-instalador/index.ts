// Edge Function: download-instalador
// Lê as releases do repositório PRIVADO do GitHub (padrão: carecaware/releases) e:
//   - entrega o instalador mais novo do BarFácil a clientes LOGADOS e CADASTRADOS;
//   - entrega a QUALQUER visitante as notas das versões (seção Novidades da página inicial).
//
// Corpo:    { acao: "novidades" }                                   (público, sem login)
//           { plataforma: "windows" | "mobile", acao: "info" | "baixar" }   (exige login e cadastro)
// Resposta: novidades -> { ok: true, versoes: [{ tag_name, name, body, published_at, assets: [{ name }] }] }
//           info      -> { ok: true, arquivo: { nome, tamanho, data, versao } }  (arquivo: null se não houver)
//           baixar    -> { ok: true, url }  link temporário do GitHub (vale poucos minutos)
//           erro      -> { ok: false, motivo }  nao_autenticado | sem_cadastro | requisicao_invalida
//                                               | nao_configurado | sem_arquivo | github_indisponivel
//
// Segredos (Supabase -> Edge Functions -> Secrets):
//   GITHUB_TOKEN     token do GitHub só de LEITURA no repositório de releases (Contents: Read-only)
//   RELEASES_REPO    opcional; padrão "carecaware/releases"
// Implantação (o login é conferido aqui dentro, porque as Novidades são públicas):
//   supabase functions deploy download-instalador --no-verify-jwt
// Depende da função eh_cliente() (supabase/downloads-e-chaves.sql).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const EXT: Record<string, RegExp> = { windows: /\.(exe|msi)$/i, mobile: /\.apk$/i };
const GH = "https://api.github.com";

type Asset = { id: number; name: string; size: number; updated_at: string };
type Release = { tag_name: string; name: string | null; body?: string | null; draft: boolean; prerelease: boolean; published_at: string | null; assets: Asset[] };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { plataforma, acao = "info" } = await req.json().catch(() => ({}));
    const token = Deno.env.get("GITHUB_TOKEN");
    const repo = Deno.env.get("RELEASES_REPO") || "carecaware/releases";
    const ghHeaders = { Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "digitaljew-site" };
    const lerReleases = async (): Promise<Release[] | null> => {
      const r = await fetch(`${GH}/repos/${repo}/releases?per_page=100`, { headers: { ...ghHeaders, Accept: "application/vnd.github+json" } });
      if (!r.ok) { console.error("github releases", r.status, await r.text()); return null; }
      return ((await r.json()) as Release[]).filter((x) => !x.draft && !x.prerelease)
        .sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)));
    };

    // Novidades: públicas (só as notas e os nomes dos arquivos; nada que permita baixar)
    if (acao === "novidades") {
      if (!token) return json({ ok: false, motivo: "nao_configurado" }, 500);
      const rels = await lerReleases();
      if (!rels) return json({ ok: false, motivo: "github_indisponivel" }, 502);
      const versoes = rels.slice(0, 100).map((x) => ({
        tag_name: x.tag_name, name: x.name, body: (x.body || "").slice(0, 4000), published_at: x.published_at,
        assets: x.assets.filter((a) => /\.(exe|msi|apk)$/i.test(a.name)).map((a) => ({ name: a.name })),
      }));
      return new Response(JSON.stringify({ ok: true, versoes }), {
        headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
      });
    }

    if (!EXT[plataforma] || !["info", "baixar"].includes(acao)) return json({ ok: false, motivo: "requisicao_invalida" }, 400);

    // 1) quem está pedindo: precisa estar logado e ter cadastro completo
    const auth = req.headers.get("Authorization") || "";
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false },
    });
    const { data: u, error: eu } = await sb.auth.getUser();
    if (eu || !u?.user) return json({ ok: false, motivo: "nao_autenticado" }, 401);
    const { data: cliente, error: ec } = await sb.rpc("eh_cliente");
    if (ec) { console.error("eh_cliente", ec.message); return json({ ok: false, motivo: "nao_configurado" }, 500); }
    if (!cliente) return json({ ok: false, motivo: "sem_cadastro" }, 403);

    // 2) release mais nova com um arquivo desta plataforma
    if (!token) return json({ ok: false, motivo: "nao_configurado" }, 500);
    const releases = await lerReleases();
    if (!releases) return json({ ok: false, motivo: "github_indisponivel" }, 502);
    let achado: { rel: Release; asset: Asset } | null = null;
    for (const rel of releases) {
      const asset = rel.assets.filter((a) => EXT[plataforma].test(a.name))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
      if (asset) { achado = { rel, asset }; break; }
    }

    if (acao === "info") {
      return json({ ok: true, arquivo: achado ? {
        nome: achado.asset.name, tamanho: achado.asset.size,
        data: achado.rel.published_at || achado.asset.updated_at, versao: achado.rel.tag_name,
      } : null });
    }
    if (!achado) return json({ ok: false, motivo: "sem_arquivo" }, 404);

    // 3) o GitHub responde com um redirecionamento para um link temporário do arquivo:
    //    devolvemos esse link, e o download sai direto do GitHub (sem passar pelo Supabase)
    const d = await fetch(`${GH}/repos/${repo}/releases/assets/${achado.asset.id}`, {
      headers: { ...ghHeaders, Accept: "application/octet-stream" },
      redirect: "manual",
    });
    const url = d.headers.get("location");
    await d.body?.cancel();
    if (d.status < 300 || d.status >= 400 || !url) { console.error("github asset", d.status); return json({ ok: false, motivo: "github_indisponivel" }, 502); }
    return json({ ok: true, url });
  } catch (e) {
    console.error(e);
    return json({ ok: false, motivo: "github_indisponivel" }, 500);
  }
});
