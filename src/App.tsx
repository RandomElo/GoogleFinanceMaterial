import { Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Accueil from "./pages/Accueil";
import Dividendes from "./pages/Dividendes";
import Fiche from "./pages/Fiche";
import Historique from "./pages/Historique";
import Introuvable from "./pages/Introuvable";
import Operations from "./pages/Operations";
import Portefeuille from "./pages/Portefeuille";

export default function App() {
    return (
        <Routes>
            <Route element={<Layout />}>
                <Route index element={<Accueil />} />
                <Route path="valeur/:symbole" element={<Fiche />} />
                <Route path="valeur/:symbole/historique" element={<Historique />} />
                <Route path="portefeuille" element={<Portefeuille />} />
                <Route path="operations" element={<Operations />} />
                <Route path="dividendes" element={<Dividendes />} />
                <Route path="*" element={<Introuvable />} />
            </Route>
        </Routes>
    );
}
