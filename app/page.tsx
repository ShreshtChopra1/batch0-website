import { headers } from "next/headers";
import Navbar from "@/components/navbar";
import Hero from "@/components/hero";
import HowItWorks from "@/components/how-it-works";
import Deliverables from "@/components/deliverables";
import Curriculum from "@/components/curriculum";
import Founder from "@/components/founder";
import Pricing from "@/components/pricing";
import FAQ from "@/components/faq";
import CTA from "@/components/cta";
import Footer from "@/components/footer";
import StickyMobileCta from "@/components/sticky-mobile-cta";
import { ChallengeMarquee } from "@/components/challenge-marquee";
import { ChallengeWinners } from "@/components/challenge-winners";
import { getPublicSiteConfig } from "@/lib/site-config";
import { getActiveChallenge, getPublicWinners } from "@/lib/challenges";
import { getCountryFromHeaders } from "@/lib/pricing";

// Title/description inherit from the root layout; the canonical is set
// here (not in the layout) so child routes don't inherit "/".
export const metadata = { alternates: { canonical: "/" } };

// This page still reads headers() for regional tuition pricing, so it stays
// dynamic — geo is genuinely per-visitor and there is no honest way to
// prerender it. What it no longer does is read cookies: the auth-dependent
// CTA moved to /home and to a client-resolved label, which removes three
// serial Supabase round trips (auth.getUser → profiles → app_roles) from the
// critical path of the site's highest-traffic page. The remaining reads are
// one parallel wave, and site config is now served from a tagged cache.
export default async function Home() {
  const countryCode = getCountryFromHeaders(headers());
  const [config, activeChallenge, winners] = await Promise.all([
    getPublicSiteConfig({ countryCode }),
    getActiveChallenge(),
    getPublicWinners(),
  ]);
  return (
    <main className="min-h-screen bg-paper">
      <Navbar cohortLabel={config.derived.cohortLabel || "the next cohort"} />
      {activeChallenge && (
        <ChallengeMarquee
          challenge={{
            slug: activeChallenge.slug,
            title: activeChallenge.title,
            marqueeText: activeChallenge.marqueeText,
            prizeLabel: activeChallenge.prizeLabel,
            ctaLabel: activeChallenge.ctaLabel,
            ctaHref: activeChallenge.ctaHref,
          }}
        />
      )}
      <Hero config={config} />
      <HowItWorks config={config} />
      <Deliverables />
      <Founder contactEmail={config.settings.contactEmail} />
      <ChallengeWinners winners={winners} />
      <Pricing config={config} />
      <FAQ config={config} />
      <CTA config={config} />
      <Footer config={config} />
      <StickyMobileCta config={config} />
    </main>
  );
}
