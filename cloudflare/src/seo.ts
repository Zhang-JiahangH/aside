import type { Episode } from "@aside/engine/core";
import type { Env } from "./env.js";
import { CloudStore } from "./store.js";
import {
  descriptions,
  episodeBody,
  episodeJsonLd,
  episodeUrl,
  episodesFor,
  homeBody,
  homeJsonLd,
  indexRobots,
  indexablePassages,
  localeOf,
  inject,
  languageAlternates,
  seoHead,
  sitemap,
  spaceTitles,
  titles,
  webSiteNode,
  SITE,
  type SeoLocale,
} from "./seo-html.js";

export { isShellRoute } from "./seo-html.js";

/** Every public recording that is ready to play, newest first. */
export async function publicEpisodes(env: Env): Promise<Episode[]> {
  const { results } = await env.DB.prepare(
    "SELECT metadata FROM episodes WHERE public=1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100",
  ).all<{ metadata: string }>();
  return results
    .map((row) => JSON.parse(row.metadata) as Episode)
    .filter((episode) => episode.status === "ready" && episode.durationMs > 0);
}

async function publicEpisode(
  env: Env,
  id: string,
): Promise<{ episode: Episode; summary: string; passages: string[] } | null> {
  const store = new CloudStore(env.DB, env.AUDIO);
  let row: Awaited<ReturnType<CloudStore["row"]>>;
  try {
    row = await store.row(id);
  } catch {
    // Unknown, deleted or someone else's private recording: answer with the
    // 404 page rather than letting the lookup failure fall through.
    return null;
  }
  if (row.public !== 1) return null;
  let episode = JSON.parse(row.metadata) as Episode;
  try {
    episode = await store.episode(row);
  } catch {
    // A missing or half-written analysis still leaves a usable landing page.
  }
  if (episode.status !== "ready" || episode.durationMs <= 0) return null;
  return {
    episode,
    summary: episode.analysis?.summary ?? "",
    passages: indexablePassages(episode),
  };
}

async function render(
  request: Request,
  env: Env,
  head: string,
  body: string,
  options: { locale?: SeoLocale; headers?: Record<string, string> } = {},
) {
  // The asset binding answers `/` with index.html; asking for `/index.html`
  // directly is answered with a redirect to `/`.
  const response = await env.ASSETS.fetch(new URL("/", request.url).toString());
  const contentType =
    response.headers.get("content-type") ?? "text/html; charset=utf-8";
  const lang = options.locale === "zh" ? "zh-CN" : "en";
  return new Response(inject(await response.text(), head, body, lang), {
    status: response.ok ? 200 : response.status,
    headers: {
      "Content-Type": contentType,
      // The body depends on the route and the library, so the asset's own
      // validators must not be reused.
      "Cache-Control": "public, max-age=0, must-revalidate",
      ...options.headers,
    },
  });
}

/** Production host, taken from the canonical URL so the two cannot drift. */
const canonicalHost = new URL(SITE).hostname;

/** Paths that serve the landing page for each interface language. */
const homePaths: Record<SeoLocale, readonly string[]> = {
  en: ["/", "/index.html"],
  zh: ["/zh"],
};

/**
 * HTML routes the Worker owns. Returning null falls through to static assets,
 * which answer unknown paths with a real 404.
 */
export async function seoRoute(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url);
  // Only the canonical host is upgraded; a dev server on http keeps working.
  if (url.protocol === "http:" && url.hostname === canonicalHost) {
    const secure = new URL(url.toString());
    secure.protocol = "https:";
    return Response.redirect(secure.toString(), 301);
  }
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const path = url.pathname;

  if (path === "/sitemap.xml") {
    const episodes = await publicEpisodes(env);
    return new Response(
      sitemap(episodes, new Date().toISOString().slice(0, 10)),
      {
        headers: {
          "Content-Type": "application/xml",
          "Cache-Control": "public, max-age=0, must-revalidate",
        },
      },
    );
  }

  if (path === "/en" || path === "/en/")
    return Response.redirect(new URL("/", request.url).toString(), 301);

  for (const locale of ["en", "zh"] as const) {
    if (!homePaths[locale].includes(path)) continue;
    const home = locale === "zh" ? "/zh" : "/";
    const episodes = episodesFor(await publicEpisodes(env), locale);
    return render(
      request,
      env,
      seoHead({
        title: titles[locale],
        description: descriptions[locale],
        canonical: `${SITE}${home}`,
        robots: indexRobots,
        locale,
        alternates: languageAlternates(),
        jsonLd: homeJsonLd(locale, episodes),
      }),
      homeBody(locale, episodes),
      { locale },
    );
  }

  const episode = /^\/episodes\/([a-zA-Z0-9-]+)\/?$/.exec(path);
  if (episode) {
    const found = await publicEpisode(env, episode[1]);
    if (!found)
      return new Response(notFoundBody(), {
        status: 404,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=0, must-revalidate",
        },
      });
    const locale = localeOf(found.episode);
    return render(
      request,
      env,
      seoHead({
        title: `${found.episode.title} · Aside`,
        description:
          found.summary ||
          `${found.episode.title} — listen and talk back on Aside.`,
        canonical: episodeUrl(found.episode.id),
        robots: indexRobots,
        locale,
        jsonLd: episodeJsonLd(found.episode, found.summary),
      }),
      episodeBody(locale, found.episode, found.summary, found.passages),
      { locale },
    );
  }

  if (path === "/space" || path.startsWith("/space/")) {
    // The private page asks not to be indexed in the header as well, so a
    // crawler that never runs JavaScript still sees it.
    const locale: SeoLocale = "en";
    return render(
      request,
      env,
      seoHead({
        title: spaceTitles[locale],
        description: descriptions[locale],
        robots: "noindex, nofollow",
        locale,
        jsonLd: { "@context": "https://schema.org", ...webSiteNode(locale) },
      }),
      "",
      { locale, headers: { "X-Robots-Tag": "noindex, nofollow" } },
    );
  }

  return null;
}

/** Small standalone page for a missing episode; keeps the 404 status. */
function notFoundBody() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Not found · Aside</title>
  </head>
  <body>
    <h1>Not found</h1>
    <p>This audio is not in the public library.</p>
    <p><a href="${SITE}/">Back to Aside</a></p>
  </body>
</html>
`;
}
