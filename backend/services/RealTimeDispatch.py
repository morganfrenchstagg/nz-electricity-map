import requests
import os
import json
import datetime
from pathlib import Path

# This is the api powering the guages on the top of https://ngawhageneration.co.nz/
ngawhaGenerationApiUrl = 'https://ngawhageneration.co.nz/api/ngawha/gauge'

# Uses the EMI Real Time Dispatch API
# Documentation Available here: https://emi.developer.azure-api.net/api-details#api=5f98fa890cf73b31bad09e10&operation=5f98fa8b243aa88e0dbe9741

emiApiUrl = 'https://emi.azure-api.net/real-time-dispatch/'
apiKey = os.environ['EMI_API_KEY']

class RealTimeDispatch:
    response = {}

    def __init__(self, existingResponse = []) -> None:
        if(len(existingResponse) > 0):
            self.response = existingResponse
            return
        response = requests.get(emiApiUrl, headers={'Ocp-Apim-Subscription-Key': apiKey})
        print("getting rtd data from api...")
        
        Path("output").mkdir(parents=True, exist_ok=True)

        if response.status_code != 200:
            with open('output/error.log', 'a') as file:
                file.write(str(datetime.datetime.now(datetime.timezone.utc)) + ' Failed to get data from RTD - Status Code: ' + str(response.status_code) + '\n')

            raise Exception('Failed to get Real Time Dispatch data')
        
        self.response = response.json()
        self.addNgawhaStationOneAndTwo()

        with open('output/realtimedispatch.json', 'w') as file:
            file.write(json.dumps(self.response, indent=1))

    def get(self, node):
        return next((x for x in self.response if x['PointOfConnectionCode'] == node), None)
    
    def getBySite(self, site):
        return list(filter(lambda x: x['PointOfConnectionCode'][:3] == site, self.response))
    
    def lastUpdated(self):
        return self.response[0]['FiveMinuteIntervalDatetime']
    
    def unclaimedGeneration(self):
        return [x for x in self.response if not x.get('claimedGeneration', False)]
    
    def unclaimedSubstation(self):
        return [x for x in self.response if not x.get('claimedSubstation', False)]
    
    # Ngāwhā Station 1 and 2 are not included in the Real Time Dispatch API, so we need to calculate their generation
    # We can do that by calling an API provided by Top Energy, which provides the total amount of generation across all Ngāwhā stations
    # We can then calculate the generation of Station 1 and 2 by subtracting the generation of Station 3, which is on the Real Time API
    def addNgawhaStationOneAndTwo(self):
        ngawhaResponse = requests.get(ngawhaGenerationApiUrl)

        # Fail Open
        if ngawhaResponse.status_code == 200:
            ngawhaResponseJson = ngawhaResponse.json()

            oec4 = self.get('KOE1101 NGB0')
            kaikoheDemand = self.get('KOE1101')

            if oec4 is None or kaikoheDemand is None:
                return
            
            oec4Generation = oec4['SPDGenerationMegawatt']
            
            totalNgawhaGeneration = float(ngawhaResponseJson['gen'])
            totalTopEnergyConsumption = float(ngawhaResponseJson['ten-load'])

            oec1and2Generation = totalNgawhaGeneration - oec4Generation

            if oec1and2Generation > 30:
                return

            self.response.append({
                "PointOfConnectionCode": "KOE1101 NGA0",
                "SPDLoadMegawatt": 0.0,
                "SPDGenerationMegawatt": oec1and2Generation,
                }
            )

            missingConsumption = totalTopEnergyConsumption - kaikoheDemand['SPDLoadMegawatt']

            self.response.append({
                "PointOfConnectionCode": "KOE1102",
                "SPDLoadMegawatt": missingConsumption,
                "SPDGenerationMegawatt": 0.0,
                "DollarsPerMegawattHour": kaikoheDemand['DollarsPerMegawattHour']
                }
            )