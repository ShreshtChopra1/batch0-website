import type { Metadata } from "next";
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
import { getSiteConfig, metaDescription } from "@/lib/site-config";
import { getActiveChallenge, getPublicWinners } from "@/lib/challenges";
import { getCountryFromHeaders } from "@/lib/pricing";
import { getProfile, roleHome } from "@/lib/auth";

// The homepage snippet is the single highest-leverage string on the site: it
// is what a student sees on Google before they ever reach us, and for most of
// them it is the only thing they will read. So it is generated per request
// from the live cohort record rather than hardcoded at build time.
//
// This costs nothing. `getSiteConfig` is memoised per request (React
// `cache()`), and the page component below already calls it — so metadata and
// body share one Supabase round-trip and can never disagree.
//
// Title inherits from the root layout. The canonical is set here, not in the
// layout, so child routes don't all inherit "/".
export async function generateMetadata(): Promise<Metadata> {
  const config = await getSiteConfig({
    // Deliberately region-agnostic: crawlers hit us from arbitrary IPs, and a
    // snippet quoting a regional discount to everyone would misprice the
    // program for most searchers. The page body still localises.
    countryCode: null,
  });
  const description = metaDescription(config);
  return {
    description,
    alternates: { canonical: "/" },
    openGraph: { description },
    twitter: { description },
  };
}

export default async function Home() {
  const countryCode = getCountryFromHeaders(headers());
  const [config, profile, activeChallenge, winners] = await Promise.all([
    getSiteConfig({ countryCode }),
    getProfile(),
    getActiveChallenge(),
    getPublicWinners(),
  ]);
  const authedHome = profile ? await roleHome(profile.role) : null;
  return (
    <main className="min-h-screen bg-paper">
      <Navbar
        authedHome={authedHome}
        cohortLabel={config.derived.cohortLabel || "the next cohort"}
      />
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
      <Hero config={config} authedHome={authedHome} />
      <HowItWorks config={config} />
      <Deliverables />
      <Founder contactEmail={config.settings.contactEmail} />
      <ChallengeWinners winners={winners} />
      <Pricing config={config} />
      <FAQ config={config} />
      <CTA config={config} />
      <Footer config={config} />
      <StickyMobileCta config={config} authedHome={authedHome} />
    </main>
  );
}
