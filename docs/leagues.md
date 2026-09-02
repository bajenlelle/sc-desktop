> **Superseded (2026-09):** imports now go through the official Genius Sports
> Warehouse API via the `genius` edge function (supabase/functions/genius) —
> see apps/desktop/src/lib/basketball-api.ts. The league-site endpoints below
> are the old scrape, kept as payload reference only; the data is the same
> feed one hop removed (its own `source` field reads
> "genius-basketball-stream-reader").

## SBL Herr
* Game schedule example URL:
https://www.sblherr.se/api/sports-v2/game-schedule?seasonUuid=ye02q4jwit&seriesUuid=qZn-4Xda9zkK3&gameTypeUuid=qZn-4XtW2vrrT&gamePlace=all&played=all
Example output: {
    "gameInfo": [
        {
            "uuid": "zgp3alxd4k",
            "rawStartDateTime": "2025-09-18T17:04:00.000Z",
            "startDateTime": "2025-09-18 19:04:00",
            "state": "post-game",
            "overtime": false,
            "shootout": null,
            "ssgtUuid": "pgv0o0t94h",
            "homeTeamInfo": {
                "status": "WIN",
                "uuid": "4fb7-b3096yiA0",
                "ownerInstanceId": "upp3_upp",
                "code": "UPP",
                "names": {
                    "code": "UPP",
                    "short": "Uppsala",
                    "long": "Uppsala Basket",
                    "full": "Uppsala Basket",
                    "codeSite": "UPP",
                    "shortSite": "Uppsala",
                    "fullSite": "Uppsala Basket Herr",
                    "longSite": "Uppsala Basket Herr"
                },
                "score": 90,
                "icon": "https://sportality.cdn.s8y.se/team-logos/upp3_upp.svg"
            },
            "awayTeamInfo": {
                "status": "LOSE",
                "uuid": "3446-983dv00Bb",
                "ownerInstanceId": "slo1_slo",
                "code": "SLO",
                "names": {
                    "code": "SLO",
                    "short": "Sloga",
                    "long": "Sloga Uppsala",
                    "full": "Sloga Uppsala Basket",
                    "codeSite": "SLO",
                    "shortSite": "Sloga",
                    "fullSite": "Sloga Uppsala Basket",
                    "longSite": "Sloga Uppsala"
                },
                "score": 84,
                "icon": "https://sportality.cdn.s8y.se/team-logos/slo1_slo.svg"
            },
            "venueInfo": {
                "uuid": "qbR-5IC5NXaP8",
                "name": "Fyrishov"
            },
            "seriesInfo": {
                "uuid": "qZn-4Xda9zkK3",
                "code": "SBL",
                "displayName": "SBL Herr"
            }
        },
        {
            "uuid": "oje7bmtts3",
            "rawStartDateTime": "2025-09-19T17:04:00.000Z",
            "startDateTime": "2025-09-19 19:04:00",
            "state": "post-game",
            "overtime": false,
            "shootout": null,
            "ssgtUuid": "pgv0o0t94h",
            "homeTeamInfo": {
                "status": "WIN",
                "uuid": "4fb7-11d4k4N32",
                "ownerInstanceId": "nkd1_nkd",
                "code": "NKD",
                "names": {
                    "code": "NKD",
                    "short": "Norrköping",
                    "long": "Norrköping Dolphins",
                    "full": "Norrköping Dolphins",
                    "codeSite": "NKDH",
                    "shortSite": "Norrköping",
                    "fullSite": "Norrköping Dolphins Herrar",
                    "longSite": "Dolphins Herrar"
                },
                "score": 89,
                "icon": "https://sportality.cdn.s8y.se/team-logos/nkd1_nkd.svg"
            },
            "awayTeamInfo": {
                "status": "LOSE",
                "uuid": "4fb7-ea69on3nB",
                "ownerInstanceId": "hob1_hob",
                "code": "HOG",
                "names": {
                    "code": "HÖG",
                    "short": "Högsbo",
                    "long": "Högsbo Basket",
                    "full": "Högsbo Basket",
                    "codeSite": "HÖG",
                    "shortSite": "Högsbo Herr",
                    "fullSite": "Högsbo Basket",
                    "longSite": "Högsbo Basket"
                },
                "score": 77,
                "icon": "https://sportality.cdn.s8y.se/team-logos/hob1_hob.svg"
            },
            "venueInfo": {
                "uuid": "qZp-9XpjZFCsS",
                "name": "Stadium Arena"
            },
            "seriesInfo": {
                "uuid": "qZn-4Xda9zkK3",
                "code": "SBL",
                "displayName": "SBL Herr"
            }
        },


* Play-By-Play example URL
https://www.sblherr.se/api/gameday/play-by-play/zgp3alxd4k
Response example: [
    {
        "gameSourceId": "2668885",
        "gameId": "2668885",
        "eventId": 820,
        "type": "game",
        "eventUuid": "3aad774f-5be5-5b7f-82b2-ff619b106322",
        "period": 4,
        "time": "00:00:00",
        "realWorldTime": "2025-09-18T19:16:15.000Z",
        "updatedTime": "2025-09-18T19:16:28.328Z",
        "homeTeam": {
            "teamId": "1376022",
            "teamName": "Uppsala Basket",
            "teamCode": "",
            "teamNumber": 1,
            "place": "home",
            "score": 90
        },
        "awayTeam": {
            "teamId": "1377786",
            "teamName": "Sloga",
            "teamCode": "",
            "teamNumber": 2,
            "place": "away",
            "score": 84
        },
        "revision": 1,
        "gameState": "unknown",
        "gameType": "",
        "round": 0,
        "startDateAndTime": "",
        "subType": "end",
        "qualifiers": [
            "confirmed"
        ],
        "isSuccessful": 1,
        "source": "genius-basketball-stream-reader",
        "gameUuid": "zgp3alxd4k"
    },
    {
        "gameSourceId": "2668885",
        "gameId": "2668885",
        "eventId": 819,
        "type": "period",
        "eventUuid": "56efe86e-084a-5bf3-a356-030be0c91070",
        "period": 4,
        "time": "00:00:00",
        "realWorldTime": "2025-09-18T19:15:42.000Z",
        "updatedTime": "2025-09-18T19:15:47.949Z",
        "homeTeam": {
            "teamId": "1376022",
            "teamName": "Uppsala Basket",
            "teamCode": "",
            "teamNumber": 1,
            "place": "home",
            "score": 90
        },
        "awayTeam": {
            "teamId": "1377786",
            "teamName": "Sloga",
            "teamCode": "",
            "teamNumber": 2,
            "place": "away",
            "score": 84
        },
        "revision": 1,
        "gameState": "unknown",
        "gameType": "",
        "round": 0,
        "startDateAndTime": "",
        "subType": "end",
        "qualifiers": [
            "confirmed"
        ],
        "isSuccessful": 1,
        "source": "genius-basketball-stream-reader",
        "gameUuid": "zgp3alxd4k"
    },
    {
        "gameSourceId": "2668885",
        "gameId": "2668885",
        "eventId": 818,
        "type": "clock",
        "eventUuid": "184522ff-c0d3-5f89-bbd8-b52605f6f2d6",
        "period": 4,
        "time": "00:00:00",
        "realWorldTime": "2025-09-18T19:15:40.000Z",
        "updatedTime": "2025-09-18T19:15:47.948Z",
        "homeTeam": {
            "teamId": "1376022",
            "teamName": "Uppsala Basket",
            "teamCode": "",
            "teamNumber": 1,
            "place": "home",
            "score": 90
        },
        "awayTeam": {
            "teamId": "1377786",
            "teamName": "Sloga",
            "teamCode": "",
            "teamNumber": 2,
            "place": "away",
            "score": 84
        },
        "revision": 1,
        "gameState": "unknown",
        "gameType": "",
        "round": 0,
        "startDateAndTime": "",
        "subType": "stop",
        "qualifiers": [],
        "isSuccessful": 1,
        "source": "genius-basketball-stream-reader",
        "gameUuid": "zgp3alxd4k"
    },
    {
        "gameSourceId": "2668885",
        "gameId": "2668885",
        "eventId": 817,
        "type": "rebound",
        "eventUuid": "b4587ced-9d46-5508-af59-1f861d34dd05",
        "period": 4,
        "time": "00:15:40",
        "realWorldTime": "2025-09-18T19:15:25.000Z",
        "updatedTime": "2025-09-18T19:15:27.813Z",
        "homeTeam": {
            "teamId": "1376022",
            "teamName": "Uppsala Basket",
            "teamCode": "",
            "teamNumber": 1,
            "place": "home",
            "score": 90
        },
        "awayTeam": {
            "teamId": "1377786",
            "teamName": "Sloga",
            "teamCode": "",
            "teamNumber": 2,
            "place": "away",
            "score": 84
        },
        "revision": 1,
        "gameState": "unknown",
        "gameType": "",
        "round": 0,
        "startDateAndTime": "",
        "eventTeam": {
            "teamId": "1376022",
            "teamName": "Uppsala Basket",
            "teamCode": "",
            "teamNumber": 1,
            "place": "home"
        },
        "player": {
            "playerId": 2305687,
            "pno": 12,
            "teamNumber": 1,
            "firstName": "Peter",
            "familyName": "Stümer"
        },
        "subType": "defensive",
        "qualifiers": [],
        "isSuccessful": 1,
        "source": "genius-basketball-stream-reader",
        "gameUuid": "zgp3alxd4k"
    },
    {
        "gameSourceId": "2668885",
        "gameId": "2668885",
        "eventId": 816,
        "type": "3pt",
        "eventUuid": "f7663828-1955-5854-85fa-0a851793ff27",
        "period": 4,
        "time": "00:18:40",
        "realWorldTime": "2025-09-18T19:15:22.000Z",
        "updatedTime": "2025-09-18T19:15:27.812Z",
        "homeTeam": {
            "teamId": "1376022",
            "teamName": "Uppsala Basket",
            "teamCode": "",
            "teamNumber": 1,
            "place": "home",
            "score": 90
        },
        "awayTeam": {
            "teamId": "1377786",
            "teamName": "Sloga",
            "teamCode": "",
            "teamNumber": 2,
            "place": "away",
            "score": 84
        },
        "revision": 1,
        "gameState": "unknown",
        "gameType": "",
        "round": 0,
        "startDateAndTime": "",
        "eventTeam": {
            "teamId": "1377786",
            "teamName": "Sloga",
            "teamCode": "",
            "teamNumber": 2,
            "place": "away"
        },
        "player": {
            "playerId": 2335533,
            "pno": 9,
            "teamNumber": 2,
            "firstName": "Milutin",
            "familyName": "Vujicic"
        },
        "coordinates": {
            "x": 73.04000091552734,
            "y": 87.4000015258789
        },
        "subType": "jumpshot",
        "qualifiers": [],
        "source": "genius-basketball-stream-reader",
        "gameUuid": "zgp3alxd4k"
    },
    {
        "gameSourceId": "2668885",
        "gameId": "2668885",
        "eventId": 815,
        "type": "rebound",
        "eventUuid": "b445e274-92b3-5183-ace4-6ace9be1afcd",
        "period": 4,
        "time": "00:23:50",
        "realWorldTime": "2025-09-18T19:15:17.000Z",
        "updatedTime": "2025-09-18T19:15:27.810Z",
        "homeTeam": {
            "teamId": "1376022",
            "teamName": "Uppsala Basket",
            "teamCode": "",
            "teamNumber": 1,
            "place": "home",
            "score": 90
        },


## SBL Dam
* Schedule URL: https://www.sbldam.se/api/sports-v2/game-schedule?seasonUuid=ye02q4jwit&seriesUuid=qZo-87H8Vw291&gameTypeUuid=qZn-4XtW2vrrT&gamePlace=all&played=all
Example reponse: {
    "gameInfo": [
        {
            "uuid": "ig0noojesa",
            "rawStartDateTime": "2025-09-27T14:00:00.000Z",
            "startDateTime": "2025-09-27 16:00:00",
            "state": "post-game",
            "overtime": false,
            "shootout": null,
            "ssgtUuid": "xzok1t5wkx",
            "homeTeamInfo": {
                "status": "WIN",
                "uuid": "4fb7-6d7311BWJI",
                "ownerInstanceId": "lul1_lul",
                "code": "LUL",
                "names": {
                    "code": "LUL",
                    "short": "Luleå",
                    "long": "Luleå Basket",
                    "full": "Luleå Basket",
                    "codeSite": "LUL",
                    "shortSite": "Luleå",
                    "fullSite": "Luleå Basket",
                    "longSite": "Luleå Basket"
                },
                "score": 90,
                "icon": "https://sportality.cdn.s8y.se/team-logos/lul1_lul.svg"
            },
            "awayTeamInfo": {
                "status": "LOSE",
                "uuid": "4fb7-6d6148G1K",
                "ownerInstanceId": "nkd1_nkd",
                "code": "NKDD",
                "names": {
                    "code": "NOR",
                    "short": "Norrköping",
                    "long": "Norrköping Dolphins",
                    "full": "Norrköping Dolphins",
                    "codeSite": "NKDD",
                    "shortSite": "NKDD",
                    "fullSite": "Dolphins Damer",
                    "longSite": "Dolphins Damer"
                },
                "score": 63,
                "icon": "https://sportality.cdn.s8y.se/team-logos/nkd1_nkd.svg"
            },
            "venueInfo": {
                "uuid": "qZp-9Xpe12SvDG",
                "name": "Luleå Energi Arena"
            },
            "seriesInfo": {
                "uuid": "qZo-87H8Vw291",
                "code": "SBLD",
                "displayName": "SBL Dam"
            }
        },
        {
            "uuid": "wh731mw3bp",
            "rawStartDateTime": "2025-09-27T14:00:00.000Z",
            "startDateTime": "2025-09-27 16:00:00",
            "state": "post-game",
            "overtime": false,
            "shootout": null,
            "ssgtUuid": "xzok1t5wkx",
            "homeTeamInfo": {
                "status": "LOSE",
                "uuid": "4fb7-957aHrw7c",
                "ownerInstanceId": "eos1_eos",
                "code": "EOSD",
                "names": {
                    "code": "EOS",
                    "short": "EOS",
                    "long": "IK Eos",
                    "full": "IK Eos",
                    "codeSite": "EOS",
                    "shortSite": "EOS",
                    "fullSite": "IK Eos",
                    "longSite": "IK Eos"
                },
                "score": 75,
                "icon": "https://sportality.cdn.s8y.se/team-logos/eos1_eos.svg"
            },
            "awayTeamInfo": {
                "status": "WIN",
                "uuid": "4fb7-8b3aV5Dme",
                "ownerInstanceId": "upp3_upp",
                "code": "UPPD",
                "names": {

* Play by Play url: https://www.sbldam.se/api/gameday/play-by-play/twjki304kz
Example response: [
    {
        "gameSourceId": "2693233",
        "gameId": "2693233",
        "eventId": 754,
        "type": "game",
        "eventUuid": "bc4c7e96-19cf-5995-839f-df0cdb36fca6",
        "period": 4,
        "time": "00:00:00",
        "realWorldTime": "2026-02-20T19:49:26.000Z",
        "updatedTime": "2026-02-20T19:49:38.027Z",
        "homeTeam": {
            "id": "69989a244e0771a12d13d7ff",
            "teamId": "188999",
            "teamCode": "",
            "teamName": "Luleå Basket",
            "name": "Luleå Basket",
            "abbreviation": "",
            "teamNumber": 1,
            "place": "home",
            "players": [],
            "score": 80
        },
        "awayTeam": {
            "id": "69989a244e0771a12d13d800",
            "teamId": "188996",
            "teamCode": "",
            "teamName": "AIK",
            "name": "AIK",
            "abbreviation": "",
            "teamNumber": 2,
            "place": "away",
            "players": [],
            "score": 61
        },
        "revision": 1,
        "gameState": "GameEnded",
        "gameType": "",
        "round": 0,
        "startDateAndTime": "",
        "subType": "end",
        "qualifiers": [
            "confirmed"
        ],
        "isSuccessful": 1,
        "source": "genius-basketball-stream-reader",
        "gameUuid": "twjki304kz"
    },
    {
        "gameSourceId": "2693233",
        "gameId": "2693233",
        "eventId": 753,
        "type": "period",
        "eventUuid": "f75804d5-ab88-51ac-a8c1-715a4d36db08",
        "period": 4,
        "time": "00:00:00",
        "realWorldTime": "2026-02-20T19:49:23.000Z",
        "updatedTime": "2026-02-20T19:49:27.856Z",
        "homeTeam": {
            "id": "69989a244e0771a12d13d7ff",
            "teamId": "188999",
            "teamCode": "",
            "teamName": "Luleå Basket",
            "name": "Luleå Basket",
            "abbreviation": "",
            "teamNumber": 1,
            "place": "home",
            "players": [],
            "score": 80
        },
        "awayTeam": {
            "id": "69989a244e0771a12d13d800",
            "teamId": "188996",
            "teamCode": "",
            "teamName": "AIK",
            "name": "AIK",
            "abbreviation": "",
            "teamNumber": 2,
            "place": "away",
            "players": [],
            "score": 61
        },
        "revision": 1,
        "gameState": "ongoing",
        "gameType": "",
        "round": 0,
        "startDateAndTime": "",
        "subType": "end",
        "qualifiers": [
            "confirmed"
        ],
        "isSuccessful": 1,
        "source": "genius-basketball-stream-reader",
        "gameUuid": "twjki304kz"
    },
    {
        "gameSourceId": "2693233",
        "gameId": "2693233",
