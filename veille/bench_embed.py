"""Banc d'essai de l'embedding — le chiffre manquant du dimensionnement.

Toute l'architecture repose sur une hypothèse NON MESURÉE : que BGE-M3 embarque
assez vite sur le CPU d'un runner GitHub Actions pour tenir dans ~10 minutes du
budget quotidien. Selon le débit réel, le volume admissible varie d'un facteur
deux. Ce script tranche la question au lieu de la supposer.

À lancer une fois, manuellement, dans un workflow séparé — surtout PAS dans le
passage quotidien : l'installation de torch coûte plusieurs minutes et plus de
2 Go, ce qu'on ne veut payer qu'une fois.

    pip install -r veille/requirements-nlp.txt
    python veille/bench_embed.py

Le banc mesure sur des textes RÉELS issus de TED, pas sur du texte synthétique :
la longueur des titres et des extraits conditionne directement le débit.

── MESURE DU 26/07/2026 ────────────────────────────────────────────────────
Machine : 24 cœurs logiques, 12 threads torch. 170 textes TED, médiane 205 car.

    lot 8 : 10,4 textes/s   ·   lot 16 : 10,3   ·   lot 32 : 10,0
    dimensions produites : 1024 — conforme à halfvec(1024) de la migration v12
    chargement du modèle : 5,6 s

Le débit ne dépend pas de la taille de lot : le modèle sature déjà le CPU à 8.
Rapporté à un runner GitHub (4 vCPU), diviser par trois à quatre donne ~3
textes/s, soit le plafond de 400 par passage en un peu plus de deux minutes —
très en deçà du garde-fou de 15 minutes.

CE QUE LA MESURE DÉPLACE. Le débit n'est pas le poste coûteux, et ce banc a
été écrit en le supposant. Ce qui coûte, c'est l'INSTALLATION de torch
(plus de 2 Go) puis le chargement du modèle à chaque passage. Le régime réel
n'embarque d'ailleurs pas les documents mais les SIGNAUX — quelques unités par
jour, pas des centaines. L'étape de vectorisation est donc dominée par ses
frais fixes, ce qui confirme après coup de l'avoir isolée dans une étape
tolérante à l'échec plutôt que de l'attacher à la collecte.
"""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

MODELE = "BAAI/bge-m3"
BUDGET_MINUTES = 10          # part du passage quotidien allouée à l'embedding


def echantillon_reel(n=256):
    """Textes réels : titre + extrait d'avis TED récents."""
    from sources import ted
    src = {"id": None, "label": "bench", "config": {}}
    docs, _ = ted.collecter(src, depuis_jours=7, pays=["FRA", "DEU", "GBR"], plafond=n)
    textes = [f"{d.title} {d.excerpt}".strip() for d in docs if d.title]
    print(f"{len(textes)} textes réels récupérés depuis TED")
    if textes:
        longueurs = sorted(len(t) for t in textes)
        print(f"longueur : médiane {longueurs[len(longueurs) // 2]} car., "
              f"max {longueurs[-1]} car.")
    return textes


def main():
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError:
        sys.exit("pip install -r veille/requirements-nlp.txt d'abord.")

    # Sans le nombre de cœurs, le débit n'est pas interprétable : une mesure sur
    # poste de développeur (24 cœurs) surestime un runner GitHub (4 vCPU) d'un
    # facteur trois à quatre. Le chiffre est noté avec sa machine.
    import os
    import torch
    print(f"machine : {os.cpu_count()} cœurs logiques, "
          f"{torch.get_num_threads()} threads torch")

    textes = echantillon_reel()
    if not textes:
        sys.exit("Aucun texte récupéré — l'API TED est-elle joignable ?")

    print(f"\nChargement de {MODELE}…")
    t0 = time.time()
    modele = SentenceTransformer(MODELE, device="cpu")
    chargement = time.time() - t0
    print(f"  chargé en {chargement:.1f} s")

    # Le premier lot inclut des allocations initiales : on le sort de la mesure.
    modele.encode(textes[:8], batch_size=8, show_progress_bar=False)

    print("\nDébit par taille de lot :")
    resultats = {}
    for lot in (8, 16, 32):
        t0 = time.time()
        vecteurs = modele.encode(textes, batch_size=lot, show_progress_bar=False)
        duree = time.time() - t0
        debit = len(textes) / duree
        resultats[lot] = debit
        print(f"  lot {lot:2d} : {debit:5.1f} textes/s "
              f"({duree:.1f} s pour {len(textes)})")

    meilleur = max(resultats.values())
    dims = vecteurs.shape[1]

    print(f"\nDimensions produites : {dims} "
          f"({'conforme' if dims == 1024 else 'ATTENTION : la migration déclare halfvec(1024)'})")

    capacite = int(meilleur * 60 * BUDGET_MINUTES)
    print(f"\n── Conclusion ──")
    print(f"Débit retenu       : {meilleur:.1f} textes/s")
    print(f"Capacité en {BUDGET_MINUTES} min : ~{capacite} documents/jour")
    print(f"Chargement modèle  : {chargement:.1f} s "
          f"(à payer une fois par passage, cache Actions actif)")

    if capacite < 500:
        print("\nVERDICT : trop lent. Options, par ordre de préférence —")
        print("  1. n'embarquer QUE les signaux retenus, pas tous les documents ;")
        print("  2. modèle plus léger (multilingual-e5-small) ;")
        print("  3. embedding un jour sur deux.")
    elif capacite < 2000:
        print("\nVERDICT : suffisant au régime actuel (~200 documents/jour),")
        print("mais à surveiller si le nombre de sources augmente.")
    else:
        print("\nVERDICT : confortable. L'hypothèse du dimensionnement tient.")


if __name__ == "__main__":
    main()
