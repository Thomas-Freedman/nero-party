# Just for reference of the unit testing performed at each stage

# Backend test commands for starting party / getting snapshot 
curl -X POST http://localhost:3000/api/party \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Party","hostName":"Tom","maxQueueLength":30,"maxSongsPerUser":5,"timeLimitSec":3600}'

curl http://localhost:3000/api/party/ PARTY CODE HERE

# 