import Navbar from "@/components/navbar";
import Footer from "@/components/footer";

// Static legal text over a static shell. The only thing that was ever dynamic
// here was the footer's contact email, and that now reads from a tagged cache.
// An hour keeps the copyright year honest across New Year without giving the
// page any per-request work.
export const revalidate = 3600;

export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Note: this layout doesn't use the @tailwindcss/typography plugin
  // (not installed). The `legal-prose` class in globals.css applies the
  // body/heading rhythm we need without pulling in a 30kb dependency.
  return (
    <main className="min-h-screen bg-paper">
      <Navbar />
      <article className="legal-prose mx-auto max-w-3xl px-6 pb-20 pt-16">
        {children}
      </article>
      <Footer />
    </main>
  );
}
