export interface GetAccountTeamMembership {
    teamId: string;
    teamName: string;
    teamRole: string;
}
export interface GetCloudproviderPlan {
    planCpu: number;
    planId: string;
    planMemory: number;
    planName: string;
}
export interface GetCloudproviderRegion {
    regionId: string;
    regionLocation: string;
    regionName: string;
}
export interface GetClusterrolesUserRole {
    name: string;
    password: string;
    teamId: string;
    uri: string;
}
export interface GetClusterstatusOperation {
    flavor: string;
    state: string;
}
