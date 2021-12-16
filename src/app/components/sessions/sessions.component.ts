import {Component, OnDestroy, OnInit} from '@angular/core';
import {WorkspaceService} from '../../services/workspace.service';
import {ActivatedRoute, Router} from '@angular/router';
import {AppService} from '../../services/app.service';
import {HttpClient} from '@angular/common/http';
import {BsModalService} from 'ngx-bootstrap/modal';
import {
  compactMode,
  globalFilteredSessions,
  globalFilterGroup,
  GlobalFilters, globalHasFilter
} from '../command-bar/command-bar.component';
import {Session} from '../../models/session';
import {Observable} from 'rxjs';

export const optionBarIds = {};

@Component({
  selector: 'app-session',
  templateUrl: './sessions.component.html',
  styleUrls: ['./sessions.component.scss']
})
export class SessionsComponent implements OnInit, OnDestroy {

  eGlobalFilterExtended: boolean;
  eGlobalFilteredSessions: Session[];
  eCompactMode: boolean;
  eGlobalFilterGroup: GlobalFilters;

  // Data for the select
  modalAccounts = [];
  currentSelectedColor;
  currentSelectedAccountNumber;

  // Ssm instances
  ssmloading = true;
  ssmRegions = [];
  instances = [];


  showOnly = 'ALL';

  private subscriptions = [];

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    public workspaceService: WorkspaceService,
    private httpClient: HttpClient,
    private modalService: BsModalService,
    private appService: AppService
  ) {
    const subscription = globalHasFilter.subscribe(value => {
      this.eGlobalFilterExtended = value;
    });
    const subscription2 = globalFilteredSessions.subscribe(value => {
      this.eGlobalFilteredSessions = value;
    });
    const subscription3 = compactMode.subscribe(value => {
      this.eCompactMode = value;
    });
    const subscription4 = globalFilterGroup.subscribe(value => {
      this.eGlobalFilterGroup = value;
    });

    this.subscriptions.push(subscription);
    this.subscriptions.push(subscription2);
    this.subscriptions.push(subscription3);
    this.subscriptions.push(subscription4);
  }

  ngOnInit() {
    // Set regions for ssm
    this.ssmRegions = this.appService.getRegions();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(subscription => {
      subscription.unsubscribe();
    });
  }

  /**
   * Go to Account Management
   */
  createAccount() {
    // Go!
    this.router.navigate(['/managing', 'create-account']).then(_ => {});
  }

  setVisibility(name) {
    if (this.showOnly === name) {
      this.showOnly = 'ALL';
    } else {
      this.showOnly = name;
    }
  }
}
