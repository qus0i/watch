# HW20 PRO — Setup Guide for New Watches

## SIM Provider
USE: Umniah Jordan
DO NOT USE: Orange Jordan (APN incompatible with HW20 PRO firmware)

## SMS Setup Sequence (in order)
1. HZ,APN,net.umniah.jo,416,03
   → wait for: HZ,APN,OK
   
2. HZ,SSAR,66.33.22.247,15769
   → wait for: HZ,SSAR,OK (sometimes appears twice)
   
3. Power off the watch completely, wait 10 seconds, power on.
4. Wait 2-5 minutes for connection.
5. Verify on dashboard: device should appear as "Active Now".

## Confirmed Working
- Firmware: KW31D_HW20PRO_V1.5_260430 (BLE)
- Firmware: KW31D_HW20PRO_V1.4_Release (W117)
- Date confirmed: 2026-05-07
- First successful IMEI: 868705080300739
