import json
from os import path
from pathlib import Path
from services.LiveGenerators import LiveGenerators
from services.LiveSubstations import LiveSubstations
from services.GeneratorDescriptions import GeneratorDescriptions
from services.SubstationDescriptions import SubstationDescriptions
from services.RealTimeDispatch import RealTimeDispatch
from services.Offers import Offers
from services.Outages import Outages

pathPrefix = 'output/'
generatorOutput = pathPrefix + 'generatorOutput.json'
substationOutput = pathPrefix + 'substationOutput.json'

def __init__():
    genDesc = GeneratorDescriptions()
    substationDescriptions = SubstationDescriptions()
    realTimeDispatch = RealTimeDispatch()
    outages = Outages()
    offers = Offers(genDesc)
    
    liveGenerators = LiveGenerators(genDesc, realTimeDispatch, outages)
    liveGenData = liveGenerators.getLiveGeneratorOutput()

    liveSubstations = LiveSubstations(realTimeDispatch, genDesc, substationDescriptions)

    createGeneratorOutputFile(liveGenData)
    create5MinuteGenerationFile(liveGenerators, realTimeDispatch, liveGenData)
    create5MinutePriceFile(realTimeDispatch)
    updateOffersTable(offers)
    createSubstationOutputFile(liveSubstations)

def updateOffersTable(offers: Offers):
    offers.updateOffers()

def create5MinuteGenerationFile(liveGenerators: LiveGenerators, realTimeDispatch: RealTimeDispatch, liveGenData):
    lastUpdated = realTimeDispatch.lastUpdated()

    existingData = {}
    dailyFile = pathPrefix + '5min/' + lastUpdated.split('T')[0] + '.json'

    Path(dailyFile).parent.mkdir(parents=True, exist_ok=True)

    if path.isfile(dailyFile) is True:
        with open(dailyFile) as fp:
            existingData = json.load(fp)

    with open(dailyFile, 'w') as file:
        file.write(json.dumps(liveGenerators.getIntervalGenerationSummary(existingData, liveGenData), indent=1))

def create5MinutePriceFile(realTimeDispatch: RealTimeDispatch):
    lastUpdated = realTimeDispatch.lastUpdated()

    existingData = {}
    dailyFile = pathPrefix + '5min/' + lastUpdated.split('T')[0] + '.price.json'
    print(dailyFile)

    if path.isfile(dailyFile) is True:
        with open(dailyFile) as fp:
            existingData = json.load(fp)

    if lastUpdated in existingData:
        return
    
    existingData[lastUpdated] = {
        'OTA2201': realTimeDispatch.get('OTA2201')['DollarsPerMegawattHour'],
        'BEN2201': realTimeDispatch.get('BEN2201')['DollarsPerMegawattHour']
    }

    with open(dailyFile, 'w') as file:
        file.write(json.dumps(existingData, indent=1))

def createGeneratorOutputFile(liveGenOutput):
    with open(generatorOutput, 'w') as file:
        file.write(json.dumps(liveGenOutput, indent=1))

def createSubstationOutputFile(liveSubstations: LiveSubstations):
    with open(substationOutput, 'w') as file:
        file.write(json.dumps(liveSubstations.getLiveSubstationOutput(), indent=1))

__init__()