#!/bin/bash

# Script de build pour Render - Résout tous les problèmes de déploiement Medusa

set -e # Arrête le script si une commande échoue

echo "🚀 Démarrage du build Medusa pour Render..."

# 1. Afficher les versions pour debug
node --version
npm --version

# 2. Installer les dépendances
echo "📦 Installation des dépendances..."
npm install

# 3. Lancer le build Medusa
echo "🔨 Build de l'application..."
npm run build

# 4. Vérifier que le dossier .medusa a été créé
if [ ! -d ".medusa/server" ]; then
  echo "❌ Erreur: Le dossier .medusa/server n'existe pas, le build a échoué"
  exit 1
fi

echo "✅ Build terminé avec succès!"

# 5. Exécuter les migrations
echo "🗄️ Exécution des migrations de base de données..."
npx medusa db:migrate

echo "🎉 Déploiement prêt! Lancement du serveur..."