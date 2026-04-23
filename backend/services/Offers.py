import requests
import os
import csv
import json
import datetime
import xml.etree.ElementTree as ET
from io import StringIO
from services.GeneratorDescriptions import GeneratorDescriptions

isProd = os.environ.get('IS_PROD', '').lower() == 'true'

if isProd:
    import boto3
    from botocore.exceptions import ClientError

OFFERS_LOOKBACK_DAYS = 7

offersUrlBase = 'https://emidatasets.blob.core.windows.net/publicdata/Datasets/Wholesale/BidsAndOffers/Offers/'
offersXML = 'https://emidatasets.blob.core.windows.net/publicdata?restype=container&comp=list&prefix=Datasets/Wholesale/BidsAndOffers/Offers'
apiKey = os.environ['EMI_API_KEY']

class Offers:
    def __init__(self, generatorDescriptions: GeneratorDescriptions) -> None:
        self.generatorDescriptions = generatorDescriptions
        if isProd:
            self.bucket = os.environ['S3_BUCKET_NAME']
            self.s3 = boto3.client('s3')
        self.metadata = self._loadMetadata()

    def updateOffers(self):
        allOfferFiles = self._getEmiFileList(offersXML)
        offerFilesToUpdate = self._filterUpdatedFiles(allOfferFiles)

        for offer in offerFilesToUpdate:
            offersString = self.getOffersForDate(offer)
            self._formatAndStore(offersString, offer['trading_date'], offer['last_modified'])

    def getOffersForDate(self, file_info):
        offersUrl = offersUrlBase + file_info['trading_date'].strftime('%Y') + "/" + file_info['trading_date'].strftime('%Y%m%d') + '_Offers.csv'

        response = requests.get(offersUrl)
        print(f"getting offer data from api for {file_info['trading_date'].strftime('%Y-%m-%d')}...")

        if response.status_code != 200:
            with open('output/error.log', 'a') as f:
                f.write(str(datetime.datetime.now(datetime.timezone.utc)) + ' Failed to get offer data - Status Code: ' + str(response.status_code) + '\n')

            raise Exception('Failed to get latest offer data')

        return response.text

    def _loadMetadata(self):
        if isProd:
            try:
                obj = self.s3.get_object(Bucket=self.bucket, Key='offers/metadata.json')
                return json.loads(obj['Body'].read())
            except ClientError:
                return {}
        else:
            try:
                with open('output/offers/metadata.json') as f:
                    return json.load(f)
            except FileNotFoundError:
                return {}

    def _filterUpdatedFiles(self, allOfferFiles):
        files_to_update = []
        cutoff_date = datetime.datetime.now() - datetime.timedelta(days=OFFERS_LOOKBACK_DAYS)

        for file_info in allOfferFiles:
            if file_info['trading_date'] < cutoff_date:
                continue

            trading_date_str = file_info['trading_date'].strftime('%Y-%m-%d')

            if trading_date_str not in self.metadata:
                files_to_update.append(file_info)
            else:
                stored_modified = datetime.datetime.fromisoformat(self.metadata[trading_date_str])
                if file_info['last_modified'] > stored_modified:
                    files_to_update.append(file_info)

        print(f"Found {len(files_to_update)} files to update out of {len(allOfferFiles)} total files (lookback: {OFFERS_LOOKBACK_DAYS} days)")
        return files_to_update

    def _formatAndStore(self, csv_string, trading_date, file_last_modified):
        date_str = trading_date.strftime('%Y-%m-%d')
        grouped = {}

        csv_reader = csv.DictReader(StringIO(csv_string))
        for row in csv_reader:
            if row['IsLatestYesNo'] == 'Y' and row['ProductClass'] == 'Injection' and row['ProductType'] == 'Energy':
                nodeAndUnit = row['PointOfConnection'] + " " + row['Unit']
                generatorDescription = self.generatorDescriptions.getByPointOfConnection(nodeAndUnit)
                site = generatorDescription['site']

                period = int(row['TradingPeriod'])
                period_start_minutes = (period - 1) * 30
                hours = period_start_minutes // 60
                minutes = period_start_minutes % 60
                timestamp = f"{date_str}T{hours:02d}:{minutes:02d}:00"

                if timestamp not in grouped:
                    grouped[timestamp] = []

                site_entry = next((s for s in grouped[timestamp] if s['site'] == site and s['unit'] == row['Unit']), None)
                if site_entry is None:
                    site_entry = {'site': site, 'unit': row['Unit'], 'tranches': []}
                    grouped[timestamp].append(site_entry)

                site_entry['tranches'].append({
                    'tranche': int(row['Tranche']),
                    'megawatts': float(row['Megawatts']) if row['Megawatts'] else None,
                    'price': float(row['DollarsPerMegawattHour']) if row['DollarsPerMegawattHour'] else None,
                })

        self.metadata[date_str] = file_last_modified.isoformat()

        if isProd:
            self.s3.put_object(
                Bucket=self.bucket,
                Key=f'offers/{date_str}.json',
                Body=json.dumps(grouped),
                ContentType='application/json',
            )
            self.s3.put_object(
                Bucket=self.bucket,
                Key='offers/metadata.json',
                Body=json.dumps(self.metadata),
                ContentType='application/json',
            )
            print(f"Uploaded offers/{date_str}.json to S3")
        else:
            with open(f'output/offers/{date_str}.json', 'w') as f:
                f.write(json.dumps(grouped))
            with open('output/offers/metadata.json', 'w') as f:
                f.write(json.dumps(self.metadata))
            print(f"Wrote output/offers/{date_str}.json")

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
                        'last_modified': last_modified,
                    })

        file_list.sort(key=lambda x: x['trading_date'], reverse=True)
        return file_list
