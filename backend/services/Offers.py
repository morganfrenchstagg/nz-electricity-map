import requests
import os
import csv
import sqlite3
import datetime
import xml.etree.ElementTree as ET
from pathlib import Path
from io import StringIO
from services.GeneratorDescriptions import GeneratorDescriptions


OFFERS_LOOKBACK_DAYS = 7

databasePath = 'output/offers.db'
offersUrlBase = 'https://emidatasets.blob.core.windows.net/publicdata/Datasets/Wholesale/BidsAndOffers/Offers/'
offersXML = 'https://emidatasets.blob.core.windows.net/publicdata?restype=container&comp=list&prefix=Datasets/Wholesale/BidsAndOffers/Offers'
apiKey = os.environ['EMI_API_KEY']

class Offers:
    def __init__(self, generatorDescriptions: GeneratorDescriptions, existingResponse = []) -> None:
        self.generatorDescriptions = generatorDescriptions

        Path("output").mkdir(parents=True, exist_ok=True)
        self._createTable()

        if len(existingResponse) > 0:
            return

    def updateOffers(self):
        allOfferFiles = self._getEmiFileList(offersXML)
        offerFilesToUpdate = self._filterUpdatedFiles(allOfferFiles)

        for offer in offerFilesToUpdate:
            offersString = self.getOffersForDate(offer)
            self._loadCsvToDatabase(offersString, offer['last_modified'])


    def getOffersForDate(self, file_info):
        offersUrl = offersUrlBase + file_info['trading_date'].strftime('%Y') + "/" + file_info['trading_date'].strftime('%Y%m%d') + '_Offers.csv'

        response = requests.get(offersUrl)
        print(f"getting offer data from api for {file_info['trading_date'].strftime('%Y-%m-%d')}...")

        if response.status_code != 200:
            with open('output/error.log', 'a') as f:
                f.write(str(datetime.datetime.now(datetime.timezone.utc)) + ' Failed to get offer data - Status Code: ' + str(response.status_code) + '\n')

            raise Exception('Failed to get latest offer data')

        return response.text

    def _createTable(self):
        conn = sqlite3.connect(databasePath)
        cursor = conn.cursor()

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS offers (
                TradingDate TEXT,
                TradingPeriod INTEGER,
                Site TEXT,
                ParticipantCode TEXT,
                PointOfConnection TEXT,
                Unit TEXT,
                ProductType TEXT,
                ProductClass TEXT,
                ReserveType TEXT,
                ProductDescription TEXT,
                UTCSubmissionDate TEXT,
                UTCSubmissionTime TEXT,
                SubmissionOrder INTEGER,
                Tranche INTEGER,
                MaximumRampUpMegawattsPerHour REAL,
                MaximumRampDownMegawattsPerHour REAL,
                PartiallyLoadedSpinningReservePercent REAL,
                MaximumOutputMegawatts REAL,
                ForecastOfGenerationPotentialMegawatts REAL,
                Megawatts REAL,
                DollarsPerMegawattHour REAL,
                FileLastModified TEXT,
                PRIMARY KEY (TradingDate, TradingPeriod, PointOfConnection, Unit, Tranche)
            )
        ''')

        conn.commit()
        conn.close()

    def _filterUpdatedFiles(self, allOfferFiles):
        conn = sqlite3.connect(databasePath)
        cursor = conn.cursor()

        files_to_update = []

        cutoff_date = datetime.datetime.now() - datetime.timedelta(days=OFFERS_LOOKBACK_DAYS)

        for file_info in allOfferFiles:
            if file_info['trading_date'] < cutoff_date:
                continue

            trading_date_str = file_info['trading_date'].strftime('%Y-%m-%d')

            cursor.execute('''
                SELECT FileLastModified
                FROM offers
                WHERE TradingDate = ?
                LIMIT 1
            ''', (trading_date_str,))

            result = cursor.fetchone()

            if result is None:
                files_to_update.append(file_info)
            else:
                db_last_modified = datetime.datetime.fromisoformat(result[0])
                if file_info['last_modified'] > db_last_modified:
                    files_to_update.append(file_info)

        conn.close()
        print(f"Found {len(files_to_update)} files to update out of {len(allOfferFiles)} total files (lookback: {OFFERS_LOOKBACK_DAYS} days)")
        return files_to_update


    def _loadCsvToDatabase(self, csv_string, file_last_modified):
        conn = sqlite3.connect(databasePath)
        cursor = conn.cursor()

        rows_to_insert = []
        csv_reader = csv.DictReader(StringIO(csv_string))

        for row in csv_reader:
            if row['IsLatestYesNo'] == 'Y' and row['ProductClass'] == 'Injection' and row['ProductType'] == 'Energy':
                nodeAndUnit = row['PointOfConnection'] + " " + row['Unit']
                generatorDescription = self.generatorDescriptions.getByPointOfConnection(nodeAndUnit)
                site = generatorDescription['site']
                rows_to_insert.append((
                    row['TradingDate'],
                    int(row['TradingPeriod']),
                    site,
                    row['ParticipantCode'],
                    row['PointOfConnection'],
                    row['Unit'],
                    row['ProductType'],
                    row['ProductClass'],
                    row['ReserveType'],
                    row['ProductDescription'],
                    row['UTCSubmissionDate'],
                    row['UTCSubmissionTime'],
                    int(row['SubmissionOrder']),
                    int(row['Tranche']),
                    float(row['MaximumRampUpMegawattsPerHour']) if row['MaximumRampUpMegawattsPerHour'] else None,
                    float(row['MaximumRampDownMegawattsPerHour']) if row['MaximumRampDownMegawattsPerHour'] else None,
                    float(row['PartiallyLoadedSpinningReservePercent']) if row['PartiallyLoadedSpinningReservePercent'] else None,
                    float(row['MaximumOutputMegawatts']) if row['MaximumOutputMegawatts'] else None,
                    float(row['ForecastOfGenerationPotentialMegawatts']) if row['ForecastOfGenerationPotentialMegawatts'] else None,
                    float(row['Megawatts']) if row['Megawatts'] else None,
                    float(row['DollarsPerMegawattHour']) if row['DollarsPerMegawattHour'] else None,
                    file_last_modified.isoformat()
                ))

        cursor.executemany('''
            INSERT OR REPLACE INTO offers VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            )
        ''', rows_to_insert)

        conn.commit()
        conn.close()
        print(f"Inserted {len(rows_to_insert)} latest offers into database")

    def getOffersByUnit(self, unit_code):
        conn = sqlite3.connect(databasePath)
        conn.row_factory = sqlite3.Row  # Return rows as dictionaries
        cursor = conn.cursor()

        cursor.execute('''
            SELECT * FROM offers
            WHERE Unit = ?
            ORDER BY TradingDate, TradingPeriod, Tranche
        ''', (unit_code,))

        results = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return results

    def getOffersByTradingPeriod(self, trading_date, trading_period):
        conn = sqlite3.connect(databasePath)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        cursor.execute('''
            SELECT * FROM offers
            WHERE TradingDate = ? AND TradingPeriod = ?
            ORDER BY PointOfConnection, Unit, Tranche
        ''', (trading_date, trading_period))

        results = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return results

    def getOffersByPointOfConnection(self, poc):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        cursor.execute('''
            SELECT * FROM offers
            WHERE PointOfConnection = ?
            ORDER BY TradingDate, TradingPeriod, Tranche
        ''', (poc,))

        results = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return results

    def _getEmiFileList(self, xml_url):
        response = requests.get(xml_url)
        if response.status_code != 200:
            raise Exception(f'Failed to get XML file list - Status Code: {response.status_code}')

        root = ET.fromstring(response.text)
        file_list = []

        for blob in root.findall('.//Blob'):
            name_elem = blob.find('Name')
            modified_elem = blob.find('.//Last-Modified')

            if name_elem is not None and modified_elem is not None:
                filename = name_elem.text

                if filename and filename.endswith('_Offers.csv'):
                    parts = filename.split('/')
                    csv_filename = parts[-1]
                    date_str = csv_filename.split('_')[0]

                    trading_date = datetime.datetime.strptime(date_str, '%Y%m%d')

                    last_modified = datetime.datetime.strptime(modified_elem.text, '%a, %d %b %Y %H:%M:%S %Z')

                    file_list.append({
                        'filename': filename,
                        'trading_date': trading_date,
                        'last_modified': last_modified
                    })

        file_list.sort(key=lambda x: x['trading_date'], reverse=True)

        return file_list