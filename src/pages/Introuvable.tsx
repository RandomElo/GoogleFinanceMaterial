import { Link } from "react-router-dom";

export default function Introuvable() {
    return (
        <div className="py-8">
            <h1 className="text-[24px]">Page introuvable</h1>
            <p className="mt-2">
                <Link to="/">Revenir à la vue du marché</Link>
            </p>
        </div>
    );
}
