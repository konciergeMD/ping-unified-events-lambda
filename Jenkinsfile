@Library(['v1-jenkins-pipeline-library', 'v1-jenkins-pipeline-library-js'])_ //importing pipeline libraries


def getEnvFromBranch(branch) {
    result = null
    switch(branch) {
      case ["master", "main"]:
        result = "prod"
        break
      case ~/^PR-.*$/:
        result = "prod"
        break
      default:
        result = "test"
        break
    }
    return result
}


jsServerlessPipeline(
    buildDefinitions: [
        buildParams: [version:"node-18", verbose: true, updateVersion: true],
    ],
   deliveryDefinitions: [
       deliveryStages: [
           test3: [
               samStacks: [
                   'a': [account: 'test',
                         stackRegions: ['us-east-1'],
                         stackSuffix: 'test3',
                         validateEnvironment: 'test3' ,
                         templateFileName: 'template.yml',
                        ]
                   ],
                   gitBranchPattern: "^(features|hotfix)/.*",
               ],
               prod: [
                  samStacks: [
                    'prod': [account: 'prod',
                             stackRegions: ['us-east-1'],
                             stackSuffix: 'prod',
                             validateEnvironment: 'prod' ,
                             templateFileName: 'template.yml',
                            ]
                           ],
                        gitBranchPattern: "^main\$",
                ],
        ],

       ],
       deliveryModel: {
               deliveryModel.parallelDelivery([
               pipelineParams: it,
               envNames: ['sandbox','test3'],
               requiresApproval: 'no'
           ,
           promotesTo: {
                       deliveryModel.parallelDelivery([
                       pipelineParams: it,
                       envNames: ['prod'],
                       requiresApproval: 'ticket'
       ])}
    ])}
)
