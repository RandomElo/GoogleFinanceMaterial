import { ChartLine } from "lucide-react";
import { Link, NavLink, Outlet } from "react-router-dom";
import Recherche from "./Recherche";

const NAVIGATION = [
    { vers: "/", libelle: "Accueil" },
    { vers: "/portefeuille", libelle: "Portefeuille" },
    { vers: "/operations", libelle: "Opérations" },
    { vers: "/dividendes", libelle: "Dividendes" },
];

export default function Layout() {
    return (
        <div className="min-h-screen">
            <header className="sticky top-0 z-20 border-b border-filet bg-fond">
                <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-8 gap-y-3 px-4 pt-3 pb-2 md:pb-3">
                    <Link to="/" className="flex items-center gap-2 text-[22px] text-muet" aria-label="Accueil">
                        <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-fond">
                            <ChartLine className="size-5" strokeWidth={2.5} aria-hidden />
                        </span>
                        <span className="text-texte">Bourse</span>
                    </Link>
                    <div className="order-last w-full md:order-none md:w-auto md:flex-1">
                        <Recherche />
                    </div>
                </div>
                <nav className="mx-auto flex max-w-[1200px] gap-1 overflow-x-auto px-2" aria-label="Navigation principale">
                    {NAVIGATION.map((n) => (
                        <NavLink
                            key={n.vers}
                            to={n.vers}
                            end={n.vers === "/"}
                            className={({ isActive }) =>
                                `shrink-0 border-b-[3px] px-3 pt-1 pb-2 text-[14px] font-medium whitespace-nowrap ${
                                    isActive ? "border-accent text-accent" : "border-transparent text-muet hover:text-texte"
                                }`
                            }
                        >
                            {n.libelle}
                        </NavLink>
                    ))}
                </nav>
            </header>

            <main className="mx-auto max-w-[1200px] px-4 pt-6 pb-12">
                <Outlet />
            </main>
        </div>
    );
}
