#!/bin/bash

# Import data from backend/output/offers.db into local D1 database

echo "Setting up local D1 database from backend..."

# Check if backend database exists
if [ ! -f "../backend/output/offers.db" ]; then
    echo "Error: Backend database not found at ../backend/output/offers.db"
    echo "Please run the backend first to generate the database."
    exit 1
fi

# Clean up old D1 state completely
echo "Removing old D1 local state..."
rm -rf .wrangler/state/v3/d1/

# Export data from backend database to SQL dump
echo "Exporting data from backend database..."
sqlite3 ../backend/output/offers.db ".dump offers" > temp-import.sql

# Import into local D1
echo "Importing into local D1 (this may take a moment for large datasets)..."
npx wrangler d1 execute offers-db --local --file=./temp-import.sql

# Clean up
rm temp-import.sql

echo "Done! Database imported successfully."

# Show stats
echo ""
echo "Database stats:"
npx wrangler d1 execute offers-db --local --command "SELECT COUNT(*) as total_rows FROM offers"
npx wrangler d1 execute offers-db --local --command "SELECT MIN(TradingDate) as earliest, MAX(TradingDate) as latest FROM offers"

echo ""
echo "Run 'npm run dev' to start the local server"
