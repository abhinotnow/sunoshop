#API SPECIFICATIONS
Please follow the instructions mentioned here. We have also written down the constraints at the end of
this file. You will get the API endpoint and the Access Token for each of the models you can access. If you
want to use the models in your application, then you have to send the POST request to that particular
“api
_
endpoint” and in the headers, you will have to paste the “access token”
- with the key name being
“access-token”
.
POST: “api
_
endpoint (you’ll get it in AnuvaadHub)”
Headers:
access-token: Requires Access token (you’ll get it in AnuvaadHub)
1. Here is the request and response payload for the models:
a. MT ( Machine Translation ):
●
Request Payload:
{
"input
_
text":"Hello, how are you?"
}
●
Response Payload:
{
"status": "success"
,
"message": "Inference performed successfully"
,
"data": {
"output
_
text": "str"
},
"error": null,
"code": 200
}
b. ASR ( Audio Speech Recognition ):
●
Request Payload:
Form Data:
audio
_
file ( in wav format )
●
Response Payload:
{
"status": "success"
,
"message": "Inference performed successfully"
,
"data": {
"recognized
text": "str "
_
},
"error": null,
"code": 200
}
c. TTS ( Text to Speech ):
●
Request Payload:
{
"text”:”string”
,
“gender”: “string” (male / female)
}
●
Response Payload:
{
"status": "success"
,
"message": "Inference performed successfully"
,
"data": {
"s3
url":
_
"https://tto-asset.s3.ap-south-1.amazonaws.com/tts
_
output/1729151441
_
8ced8a6aea0b504df2.wav"
},
"error": null,
"code": 200
670bc7
}
d. OCR ( Optical Character Recognition ):
●
Request Payload:
Form-data:
file (in jpg/png/jpeg format)
●
Response Payload:
{
"status": "success"
,
"message": "OCR Inference performed successfully"
,
"data": {
"decoded
_
text": "string"
},
"error": null,
"code": 200
}
Please find the Python code snippets and curl calls for the Models in here:
https://github.com/deciphyre/code_snippets_for_anuvaadhub/
CONSTRAINTS:
1. MT: Maximum of 50 words.
2. ASR: Limit of around 20 seconds and file size below 5MB. The WAV file is
accepted and is clearer.
3. TTS: Maximum of 30 words and no special characters allowed.
4. OCR: File being les