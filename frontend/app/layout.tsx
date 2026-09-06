import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import "./betting.css";

export const metadata: Metadata = {
  title: "IDDA Olasılık Merkezi",
  description: "Kalibre edilmiş Avrupa futbol maç olasılıkları",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">IDDA <span>OLASILIK</span></Link>
          <nav><Link href="/">Tahminler</Link><Link href="/admin">Model merkezi</Link></nav>
        </header>
        {children}
      </body>
    </html>
  );
}
