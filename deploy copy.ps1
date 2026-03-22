$repoPath = "C:\Users\micha\OneDrive\Documents\CAT_GAME\catlobby"
$branch = "new_feature_postgres_three"
$ec2 = "ubuntu@3.87.255.8"
$key = "C:\Users\micha\Downloads\catlobby.pem"

Write-Host "Pushing code to GitHub..."

cd $repoPath

git add .
git commit -m "Auto deploy"
git push origin $branch

Write-Host "Triggering EC2 deploy..."

ssh -i $key $ec2 "cd ~/catlobby && ./deploy.sh"
#ssh -i $key $ec2 "cd ~/catlobby && chmod +x deploy.sh && ./deploy.sh"
#ssh -i $key $ec2 "cd ~/catlobby && chmod +x deploy.sh && bash deploy.sh"
Write-Host "Deployment finished!"