import {CredentialsInfo} from '../../../../models/credentials-info';
import {AwsIamUserSession} from '../../../../models/aws-iam-user-session';
import {KeychainService} from '../../../keychain-service';
import {Session} from '../../../../models/session';
import * as AWS from 'aws-sdk';
import {GetSessionTokenResponse} from 'aws-sdk/clients/sts';
import {constants} from '../../../../models/constants';
import {LeappAwsStsError} from '../../../../errors/leapp-aws-sts-error';
import {LeappParseError} from '../../../../errors/leapp-parse-error';
import {LeappMissingMfaTokenError} from '../../../../errors/leapp-missing-mfa-token-error';
import Repository from '../../../repository';
import {FileService} from '../../../file-service';
import AwsSessionService from '../aws-session-service';
import {LeappBaseError} from '../../../../errors/leapp-base-error';
import {LoggerLevel} from '../../../logging-service';
import AppService2 from '../../../app-service2';
import ISessionNotifier from '../../../../models/i-session-notifier';

export interface AwsIamUserSessionRequest {
  accountName: string;
  accessKey: string;
  secretKey: string;
  region: string;
  mfaDevice?: string;
}

export interface IMfaCodePrompter {
  promptForMFACode(sessionName: string, callback: any): void;
}

export default class AwsIamUserService extends AwsSessionService {

  private static instance: AwsIamUserService;
  private mfaCodePrompter: IMfaCodePrompter;
  private repository: Repository;

  private constructor(
    iSessionNotifier: ISessionNotifier,
    mfaCodePrompter: IMfaCodePrompter
  ) {
    super(iSessionNotifier);
    this.mfaCodePrompter = mfaCodePrompter;
    this.repository = Repository.getInstance();
  }

  static getInstance() {
    if(!this.instance) {
      // TODO: understand if we need to move Leapp Errors in a core folder
      throw new LeappBaseError('Not initialized service error', this, LoggerLevel.error,
        'Service needs to be initialized');
    }
    return this.instance;
  }

  static init(iSessionNotifier: ISessionNotifier, mfaCodePrompter: IMfaCodePrompter) {
    if(this.instance) {
      // TODO: understand if we need to move Leapp Errors in a core folder
      throw new LeappBaseError('Already initialized service error', this, LoggerLevel.error,
        'Service already initialized');
    }
    this.instance = new AwsIamUserService(iSessionNotifier, mfaCodePrompter);
  }

  static isTokenExpired(tokenExpiration: string): boolean {
    const now = Date.now();
    return now > new Date(tokenExpiration).getTime();
  }

  static sessionTokenFromGetSessionTokenResponse(getSessionTokenResponse: GetSessionTokenResponse): { sessionToken: any } {
    return {
      sessionToken: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        aws_access_key_id: getSessionTokenResponse.Credentials.AccessKeyId.trim(),
        // eslint-disable-next-line @typescript-eslint/naming-convention
        aws_secret_access_key: getSessionTokenResponse.Credentials.SecretAccessKey.trim(),
        // eslint-disable-next-line @typescript-eslint/naming-convention
        aws_session_token: getSessionTokenResponse.Credentials.SessionToken.trim(),
      }
    };
  }

  create(accountRequest: AwsIamUserSessionRequest, profileId: string): void {
    const session = new AwsIamUserSession(accountRequest.accountName, accountRequest.region, profileId, accountRequest.mfaDevice);
    KeychainService.getInstance().saveSecret(constants.appName, `${session.sessionId}-iam-user-aws-session-access-key-id`, accountRequest.accessKey)
      .then(_ => {
        KeychainService.getInstance().saveSecret(constants.appName, `${session.sessionId}-iam-user-aws-session-secret-access-key`, accountRequest.secretKey)
          .catch(err => console.error(err));
      })
      .catch(err => console.error(err));

    this.iSessionNotifier.addSession(session);
  }

  async applyCredentials(sessionId: string, credentialsInfo: CredentialsInfo): Promise<void> {
    //const session = this.workspaceService.get(sessionId);
    const session = this.repository.getSessions().find(sess => sess.sessionId === sessionId);
    const profileName = Repository.getInstance().getProfileName((session as AwsIamUserSession).profileId);
    const credentialObject = {};
    credentialObject[profileName] = {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      aws_access_key_id: credentialsInfo.sessionToken.aws_access_key_id,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      aws_secret_access_key: credentialsInfo.sessionToken.aws_secret_access_key,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      aws_session_token: credentialsInfo.sessionToken.aws_session_token,
      region: session.region
    };
    return await FileService.getInstance().iniWriteSync(AppService2.getInstance().awsCredentialPath(), credentialObject);
  }

  async deApplyCredentials(sessionId: string): Promise<void> {
    //const session = this.workspaceService.get(sessionId);
    const session = this.repository.getSessions().find(sess => sess.sessionId === sessionId);
    const profileName = Repository.getInstance().getProfileName((session as AwsIamUserSession).profileId);
    const credentialsFile = await FileService.getInstance().iniParseSync(AppService2.getInstance().awsCredentialPath());
    delete credentialsFile[profileName];
    return await FileService.getInstance().replaceWriteSync(AppService2.getInstance().awsCredentialPath(), credentialsFile);
  }

  async generateCredentials(sessionId: string): Promise<CredentialsInfo> {
    // Get the session in question
    //const session = this.workspaceService.get(sessionId);
    const session = this.repository.getSessions().find(sess => sess.sessionId === sessionId);
    // Retrieve session token expiration
    const tokenExpiration = (session as AwsIamUserSession).sessionTokenExpiration;
    // Check if token is expired
    if (!tokenExpiration || AwsIamUserService.isTokenExpired(tokenExpiration)) {
      // Token is Expired!
      // Retrieve access keys from keychain
      const accessKeyId = await this.getAccessKeyFromKeychain(sessionId);
      const secretAccessKey = await this.getSecretKeyFromKeychain(sessionId);
      // Get session token
      // https://docs.aws.amazon.com/STS/latest/APIReference/API_GetSessionToken.html
      AWS.config.update({ accessKeyId, secretAccessKey });
      // Configure sts client options
      const sts = new AWS.STS(AppService2.getInstance().stsOptions(session));
      // Configure sts get-session-token api call params
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const params = { DurationSeconds: constants.sessionTokenDuration };
      // Check if MFA is needed or not
      if ((session as AwsIamUserSession).mfaDevice) {
        // Return session token after calling MFA modal
        return this.generateSessionTokenCallingMfaModal(session, sts, params);
      } else {
        // Return session token in the form of CredentialsInfo
        return this.generateSessionToken(session, sts, params);
      }
    } else {
      // Session Token is NOT expired
      try {
        // Retrieve session token from keychain
        return JSON.parse(await KeychainService.getInstance().getSecret(constants.appName, `${session.sessionId}-iam-user-aws-session-token`));
      } catch (err) {
        throw new LeappParseError(this, err.message);
      }
    }
  }

  async getAccountNumberFromCallerIdentity(session: Session): Promise<string> {
    // Get credentials
    const credentials: CredentialsInfo = await this.generateCredentials(session.sessionId);
    AWS.config.update({ accessKeyId: credentials.sessionToken.aws_access_key_id, secretAccessKey: credentials.sessionToken.aws_secret_access_key, sessionToken: credentials.sessionToken.aws_session_token });
    // Configure sts client options
    try {
      const sts = new AWS.STS(AppService2.getInstance().stsOptions(session));
      const response = await sts.getCallerIdentity({}).promise();
      return response.Account;
    } catch (err) {
      throw new LeappAwsStsError(this, err.message);
    }
  }

  removeSecrets(sessionId: string): void {
    this.removeAccessKeyFromKeychain(sessionId).then( _ => {
      this.removeSecretKeyFromKeychain(sessionId).then( __ => {
        this.removeSessionTokenFromKeychain(sessionId).catch(err => {
          throw err;
        });
      }).catch(err => {
        throw err;
      });
    }).catch(err => {
      throw err;
    });
  }

  // eslint-disable-next-line @typescript-eslint/naming-convention
  private generateSessionTokenCallingMfaModal(session: Session, sts: AWS.STS, params: { DurationSeconds: number }): Promise<CredentialsInfo> {
    return new Promise((resolve, reject) => {
      // TODO: think about timeout management
      // TODO: handle condition in which mfaCodePrompter is null
      this.mfaCodePrompter.promptForMFACode(session.sessionName, (value) => {
        if (value !== constants.confirmClosed) {
          params['SerialNumber'] = (session as AwsIamUserSession).mfaDevice;
          params['TokenCode'] = value;
          // Return session token in the form of CredentialsInfo
          resolve(this.generateSessionToken(session, sts, params));
        } else {
          reject(new LeappMissingMfaTokenError(this, 'Missing Multi Factor Authentication code'));
        }
      });
    });
  }

  private async getAccessKeyFromKeychain(sessionId: string): Promise<string> {
    return await KeychainService.getInstance().getSecret(constants.appName, `${sessionId}-iam-user-aws-session-access-key-id`);
  }

  private async getSecretKeyFromKeychain(sessionId: string): Promise<string> {
    return await KeychainService.getInstance().getSecret(constants.appName, `${sessionId}-iam-user-aws-session-secret-access-key`);
  }

  private async removeAccessKeyFromKeychain(sessionId: string): Promise<void> {
    await KeychainService.getInstance().deletePassword(constants.appName, `${sessionId}-iam-user-aws-session-access-key-id`);
  }

  private async removeSecretKeyFromKeychain(sessionId: string): Promise<void> {
    await KeychainService.getInstance().deletePassword(constants.appName, `${sessionId}-iam-user-aws-session-secret-access-key`);
  }

  private async removeSessionTokenFromKeychain(sessionId: string): Promise<void> {
    await KeychainService.getInstance().deletePassword(constants.appName, `${sessionId}-iam-user-aws-session-token`);
  }

  private async generateSessionToken(session: Session, sts: AWS.STS, params: any): Promise<CredentialsInfo> {
    try {
      // Invoke sts get-session-token api
      const getSessionTokenResponse: GetSessionTokenResponse = await sts.getSessionToken(params).promise();

      // Save session token expiration
      this.saveSessionTokenResponseInTheSession(session, getSessionTokenResponse);

      // Generate correct object from session token response
      const sessionToken = AwsIamUserService.sessionTokenFromGetSessionTokenResponse(getSessionTokenResponse);

      // Save in keychain the session token
      await KeychainService.getInstance().saveSecret(constants.appName, `${session.sessionId}-iam-user-aws-session-token`, JSON.stringify(sessionToken));

      // Return Session Token
      return sessionToken;
    } catch (err) {
      throw new LeappAwsStsError(this, err.message);
    }
  }

  private saveSessionTokenResponseInTheSession(session: Session, getSessionTokenResponse: AWS.STS.GetSessionTokenResponse): void {
    const index = this.iSessionNotifier.getSessions().indexOf(session);
    const currentSession: Session = this.iSessionNotifier.getSessions()[index];

    (currentSession as AwsIamUserSession).sessionTokenExpiration = getSessionTokenResponse.Credentials.Expiration.toISOString();

    this.iSessionNotifier.getSessions()[index] = currentSession;
    this.iSessionNotifier.setSessions([...this.iSessionNotifier.getSessions()]);

    Repository.getInstance().updateSessions(this.iSessionNotifier.getSessions());
  }
}
