/* tslint:disable:max-file-line-count */

import {Injectable} from '@angular/core';
import {SafeUrl} from '@angular/platform-browser';
import {Router} from '@angular/router';
import * as htmlToText from 'html-to-text';
import * as msgpack from 'msgpack-lite';
import {DeltaOperation, DeltaStatic} from 'quill';
import * as Delta from 'quill-delta';
import * as QuillDeltaToHtml from 'quill-delta-to-html';
import {BehaviorSubject} from 'rxjs/BehaviorSubject';
import {Observable} from 'rxjs/Observable';
import {of} from 'rxjs/observable/of';
import {concat} from 'rxjs/operators/concat';
import {filter} from 'rxjs/operators/filter';
import {first} from 'rxjs/operators/first';
import {map} from 'rxjs/operators/map';
import {mergeMap} from 'rxjs/operators/mergeMap';
import {take} from 'rxjs/operators/take';
import {toArray} from 'rxjs/operators/toArray';
import {SecurityModels} from '../account';
import {Async} from '../async-type';
import {IProto} from '../iproto';
import {IQuillDelta} from '../iquill-delta';
import {IQuillRange} from '../iquill-range';
import {
	AccountFileRecord,
	AccountFileReference,
	AccountFileReferenceContainer,
	Appointment,
	BinaryProto,
	BlobProto,
	DataURIProto,
	Form,
	IAccountFileRecord,
	IAccountFileReference,
	IAccountFileReferenceContainer,
	IAppointment,
	IForm,
	NotificationTypes
} from '../proto';
import {filterUndefined} from '../util/filter';
import {cacheObservable} from '../util/flatten-observable';
import {getOrSetDefaultAsync} from '../util/get-or-set-default';
import {saveFile} from '../util/save-file';
import {deserialize, serialize} from '../util/serialization';
import {getTimestamp} from '../util/time';
import {uuid} from '../util/uuid';
import {awaitAsync, sleep} from '../util/wait';
import {AccountDatabaseService} from './crypto/account-database.service';
import {PotassiumService} from './crypto/potassium.service';
import {DatabaseService} from './database.service';
import {DialogService} from './dialog.service';
import {StringsService} from './strings.service';


/**
 * Account file service.
 */
@Injectable()
export class AccountFilesService {
	/** @ignore */
	private readonly incomingFileCache: Map<
		Uint8Array,
		IAccountFileRecord&IAccountFileReference
	>	=
		new Map<Uint8Array, IAccountFileRecord&IAccountFileReference>()
	;

	/** @ignore */
	private readonly nonexistentFile: IAccountFileRecord&IAccountFileReference	= {
		id: '',
		key: new Uint8Array(0),
		mediaType: '',
		name: '',
		owner: '',
		recordType: AccountFileRecord.RecordTypes.File,
		size: NaN,
		timestamp: 0,
		wasAnonymousShare: false
	};

	/** @ignore */
	private readonly noteSnippets: Map<string, string>	= new Map<string, string>();

	/** List of file records owned by current user, sorted by timestamp in descending order. */
	public readonly filesList: Observable<(IAccountFileRecord&{owner: string})[]>	=
		cacheObservable(
			this.accountDatabaseService.watchList(
				'fileReferences',
				AccountFileReference,
				undefined,
				undefined,
				undefined,
				false
			).pipe(
				mergeMap(async references => filterUndefined(await Promise.all(
					references.map(async ({value}) => {
						try {
							if (!value.owner) {
								return;
							}

							const record	= await this.accountDatabaseService.getItem(
								`users/${value.owner}/fileRecords/${value.id}`,
								AccountFileRecord,
								undefined,
								value.key
							);

							return {
								id: record.id,
								mediaType: record.mediaType,
								name: record.name,
								owner: value.owner,
								recordType: record.recordType,
								size: record.size,
								timestamp: record.timestamp,
								wasAnonymousShare: record.wasAnonymousShare
							};
						}
						catch {
							return;
						}
					})
				))),
				map(records =>
					records.sort((a, b) => b.timestamp - a.timestamp)
				)
			),
			[]
		)
	;

	/**
	 * Files filtered by record type.
	 * @see files
	 */
	public readonly filesListFiltered	= {
		appointments: this.filterFiles(this.filesList, AccountFileRecord.RecordTypes.Appointment),
		docs: this.filterFiles(this.filesList, AccountFileRecord.RecordTypes.Doc),
		files: this.filterFiles(this.filesList, AccountFileRecord.RecordTypes.File),
		forms: this.filterFiles(this.filesList, AccountFileRecord.RecordTypes.Form),
		notes: this.filterFiles(this.filesList, AccountFileRecord.RecordTypes.Note)
	};

	/** Incoming files. */
	public readonly incomingFiles: Observable<(IAccountFileRecord&IAccountFileReference)[]>	=
		this.accountDatabaseService.currentUser.pipe(mergeMap(o =>
			!o ? [] : this.databaseService.watchList(
				`users/${o.user.username}/incomingFiles`,
				BinaryProto
			).pipe(mergeMap(async arr =>
				(await Promise.all(arr.map(async ({value}) => getOrSetDefaultAsync(
					this.incomingFileCache,
					value,
					async () => {
						try {
							const currentUser	= this.accountDatabaseService.currentUser.value;

							if (!currentUser) {
								return this.nonexistentFile;
							}

							const referenceContainer	= await deserialize(
								AccountFileReferenceContainer,
								await this.potassiumService.box.open(
									value,
									o.keys.encryptionKeyPair
								)
							);

							let record: IAccountFileRecord;
							let reference: IAccountFileReference;

							if (referenceContainer.anonymousShare) {
								record	= referenceContainer.anonymousShare.accountFileRecord;
								record.wasAnonymousShare	= true;

								reference	= {
									id: record.id,
									key: referenceContainer.anonymousShare.key,
									owner: currentUser.user.username
								};
							}
							else if (referenceContainer.signedShare) {
								reference	= await deserialize(
									AccountFileReference,
									await this.potassiumService.sign.open(
										referenceContainer.signedShare.accountFileReference,
										(await this.accountDatabaseService.getUserPublicKeys(
											referenceContainer.signedShare.owner
										)).signing
									)
								);

								record	= await this.accountDatabaseService.getItem(
									`users/${reference.owner}/fileRecords/${reference.id}`,
									AccountFileRecord,
									undefined,
									reference.key
								);
							}
							else {
								return this.nonexistentFile;
							}

							return {
								id: record.id,
								key: reference.key,
								mediaType: record.mediaType,
								name: record.name,
								owner: reference.owner,
								recordType: record.recordType,
								size: record.size,
								timestamp: record.timestamp,
								wasAnonymousShare: record.wasAnonymousShare
							};
						}
						catch {
							return this.nonexistentFile;
						}
					}
				)))).
					filter(file => file !== this.nonexistentFile)
			))
		))
	;

	/**
	 * Incoming files filtered by record type.
	 * @see files
	 */
	public readonly incomingFilesFiltered	= {
		appointments: this.filterFiles(
			this.incomingFiles,
			AccountFileRecord.RecordTypes.Appointment
		),
		docs: this.filterFiles(this.incomingFiles, AccountFileRecord.RecordTypes.Doc),
		files: this.filterFiles(this.incomingFiles, AccountFileRecord.RecordTypes.File),
		forms: this.filterFiles(this.incomingFiles, AccountFileRecord.RecordTypes.Form),
		notes: this.filterFiles(this.incomingFiles, AccountFileRecord.RecordTypes.Note)
	};

	/** Indicates whether the first load has completed. */
	public initiated: boolean	= false;

	/** Indicates whether spinner should be displayed. */
	public showSpinner: boolean	= true;

	/** @ignore */
	private deltaToString (delta: IQuillDelta) : string {
		return htmlToText.fromString(new QuillDeltaToHtml(delta.ops).convert());
	}

	/** @ignore */
	private downloadItem<T> (
		id: string|IAccountFileRecord,
		proto: IProto<T>,
		securityModel?: SecurityModels
	) : {
		progress: Observable<number>;
		result: Promise<T>;
	} {
		const filePromise	= this.getFile(id);

		const {progress, result}	= this.accountDatabaseService.downloadItem(
			filePromise.then(file => `users/${file.owner}/files/${file.id}`),
			proto,
			securityModel,
			filePromise.then(file => file.key)
		);

		return {progress, result: result.then(o => o.value)};
	}

	/** @ignore */
	private fileIsAppointment (file: IAppointment|IForm|IQuillDelta|File) : boolean {
		const maybeAppointment	= <any> file;
		return maybeAppointment.calendarInvite !== undefined;
	}

	/** @ignore */
	private fileIsDelta (file: IAppointment|IForm|IQuillDelta|File) : boolean {
		const maybeDelta	= <any> file;
		return typeof maybeDelta.chop === 'function' || maybeDelta.ops instanceof Array;
	}

	/** @ignore */
	private filterFiles<T extends {owner: string}> (
		filesList: Observable<(IAccountFileRecord&T)[]>,
		filterRecordTypes: AccountFileRecord.RecordTypes
	) : Observable<(IAccountFileRecord&T)[]> {
		return cacheObservable(
			filesList.pipe(map(files => files.filter(({owner, recordType}) =>
				!!owner && recordType === filterRecordTypes
			))),
			[]
		);
	}

	/** Accepts or rejects incoming file. */
	public async acceptIncomingFile (
		incomingFile: IAccountFileRecord&IAccountFileReference,
		shouldAccept: boolean = true
	) : Promise<void> {
		const promises: Promise<any>[]	= [
			this.accountDatabaseService.removeItem(`incomingFiles/${incomingFile.id}`)
		];

		if (shouldAccept) {
			promises.push(this.accountDatabaseService.setItem<IAccountFileReference>(
				`fileReferences/${incomingFile.id}`,
				AccountFileReference,
				incomingFile
			));

			if (incomingFile.wasAnonymousShare) {
				promises.push(this.accountDatabaseService.setItem<IAccountFileRecord>(
					`fileRecords/${incomingFile.id}`,
					AccountFileRecord,
					incomingFile,
					undefined,
					incomingFile.key
				));
			}

			if (incomingFile.recordType === AccountFileRecord.RecordTypes.Appointment) {
				/*
				Temporarily commented out pending final appointments architecture

				promises.push((async () => {
					const currentUser	= this.accountDatabaseService.currentUser.value;

					if (!currentUser) {
						throw new Error('User not signed in. Cannot RSVP.');
					}

					const appointment	= await this.downloadAppointment(incomingFile).result;

					if (!appointment.rsvps) {
						appointment.rsvps	= {};
					}

					appointment.rsvps[currentUser.user.username]	= Appointment.RSVP.Yes;

					return this.accountDatabaseService.setItem(
						`users/${incomingFile.owner}/files/${incomingFile.id}`,
						Appointment,
						appointment,
						undefined,
						incomingFile.key
					);
				})());
				*/
			}
		}

		await Promise.all(promises);
	}

	/** Downloads and saves file. */
	public downloadAndSave (id: string) : {
		progress: Observable<number>;
		result: Promise<void>;
	} {
		const {progress, result}	= this.downloadItem(id, BinaryProto);

		return {
			progress,
			result: (async () => {
				const file	= await this.getFile(id);

				await saveFile(
					await result,
					file.name,
					file.mediaType
				);
			})()
		};
	}

	/** Downloads and returns appointment. */
	public downloadAppointment (id: string|IAccountFileRecord) : {
		progress: Observable<number>;
		result: Promise<IAppointment>;
	} {
		return this.downloadItem(id, Appointment);
	}

	/** Downloads file and returns form. */
	public downloadForm (id: string|IAccountFileRecord) : {
		progress: Observable<number>;
		result: Promise<IForm>;
	} {
		return this.downloadItem(id, Form, SecurityModels.privateSigned);
	}

	/** Downloads file and returns as data URI. */
	public downloadURI (id: string|IAccountFileRecord) : {
		progress: Observable<number>;
		result: Promise<SafeUrl|string>;
	} {
		return this.downloadItem(id, DataURIProto);
	}

	/** Gets the specified file record. */
	public async getFile (
		id: string|IAccountFileRecord|(IAccountFileRecord&IAccountFileReference),
		recordType?: AccountFileRecord.RecordTypes
	) : Promise<IAccountFileRecord&IAccountFileReference> {
		if (typeof id !== 'string') {
			const maybeFileReference: any	= id;
			if (maybeFileReference.owner !== undefined && maybeFileReference.key !== undefined) {
				return maybeFileReference;
			}
			else {
				id	= id.id;
			}
		}

		await this.accountDatabaseService.getCurrentUser();

		const reference	= await this.accountDatabaseService.getItem(
			`fileReferences/${id}`,
			AccountFileReference
		);

		const record	= await this.accountDatabaseService.getItem(
			`users/${reference.owner}/fileRecords/${reference.id}`,
			AccountFileRecord,
			undefined,
			reference.key
		);

		if (recordType !== undefined && record.recordType !== recordType) {
			throw new Error('Specified file does not exist.');
		}

		return {
			id,
			key: reference.key,
			mediaType: record.mediaType,
			name: record.name,
			owner: reference.owner,
			recordType: record.recordType,
			size: record.size,
			timestamp: record.timestamp
		};
	}

	/** Gets the Material icon name for the file default thumbnail. */
	public getThumbnail (mediaType: string) : 'insert_drive_file'|'movie'|'photo' {
		const typeCategory	= mediaType.split('/')[0];

		switch (typeCategory) {
			case 'image':
				return 'photo';

			case 'video':
				return 'movie';

			default:
				return 'insert_drive_file';
		}
	}

	/** Returns a snippet of a note to use as a preview. */
	public noteSnippet (id: string) : string {
		if (!this.noteSnippets.has(id)) {
			this.noteSnippets.set(id, '...');

			(async () => {
				const limit		= 75;
				const file		= await this.getFile(id);
				const content	= this.deltaToString(
					msgpack.decode(
						await this.accountDatabaseService.getItem(
							`users/${file.owner}/files/${id}`,
							BinaryProto,
							undefined,
							file.key
						)
					)
				);

				this.noteSnippets.set(
					id,
					content.length > limit ?
						`${content.substr(0, limit)}...` :
						content
				);
			})();
		}

		return this.noteSnippets.get(id) || '';
	}

	/** Opens a file. */
	public async openFile (id: string) : Promise<void> {
		const file	= await this.getFile(id);

		if (file.mediaType.indexOf('image/') === 0) {
			this.dialogService.image(await this.downloadURI(id).result);
		}
		else {
			this.downloadAndSave(id);
		}
	}

	/** Removes a file. */
	public async remove (
		id: string|Async<IAccountFileRecord>,
		confirmAndRedirect: boolean = true
	) : Promise<void> {
		if (typeof id !== 'string') {
			id	= (await awaitAsync(id)).id;
		}

		const file	= await this.getFile(id);

		if (confirmAndRedirect) {
			if (await this.dialogService.confirm({
				content: `${this.stringsService.deleteMessage} ${file.name}?`,
				title: this.stringsService.deleteConfirm
			})) {
				this.router.navigate([
					accountRoot,
					file.recordType === AccountFileRecord.RecordTypes.Appointment ?
						'appointments' :
						file.recordType === AccountFileRecord.RecordTypes.Doc ?
							'docs' :
							file.recordType === AccountFileRecord.RecordTypes.File ?
								'files' :
								file.recordType === AccountFileRecord.RecordTypes.Form ?
									'forms' :
									'notes'
				]);

				await sleep();
			}
			else {
				return;
			}
		}

		const promises	= [
			this.accountDatabaseService.removeItem(`fileReferences/${id}`)
		];

		if (
			this.accountDatabaseService.currentUser.value &&
			file.owner === this.accountDatabaseService.currentUser.value.user.username
		) {
			promises.push(...[
				this.accountDatabaseService.removeItem(`users/${file.owner}/docs/${id}`),
				this.accountDatabaseService.removeItem(`users/${file.owner}/files/${id}`),
				this.accountDatabaseService.removeItem(`users/${file.owner}/fileRecords/${id}`)
			]);
		}

		await Promise.all(promises);
	}

	/** Shares file with another user. */
	public async shareFile (
		id: string|AccountFileReferenceContainer.IAnonymousShare,
		username: string
	) : Promise<void> {
		if (
			this.accountDatabaseService.currentUser.value &&
			this.accountDatabaseService.currentUser.value.user.username === username
		) {
			return;
		}

		let accountFileReferenceContainer: IAccountFileReferenceContainer;

		const fileType	=
			typeof id !== 'string' ?
				id.accountFileRecord.recordType :
				this.accountDatabaseService.getItem(
					`fileReferences/${id}`,
					AccountFileReference
				).then(async o =>
					this.accountDatabaseService.getItem(
						`fileRecords/${id}`,
						AccountFileRecord,
						undefined,
						o.key
					)
				).then(o =>
					o.recordType
				)
		;

		/* Anonymous */
		if (typeof id !== 'string') {
			accountFileReferenceContainer	= {anonymousShare: id};
			id	= id.accountFileRecord.id;
		}
		/* Non-anonymous/signed */
		else if (this.accountDatabaseService.currentUser.value) {
			const data	=
				await this.accountDatabaseService.getItem(`fileReferences/${id}`, BinaryProto)
			;

			accountFileReferenceContainer	= {signedShare: {
				accountFileReference: await this.potassiumService.sign.sign(
					data,
					this.accountDatabaseService.currentUser.value.keys.signingKeyPair.privateKey
				),
				owner: this.accountDatabaseService.currentUser.value.user.username
			}};
		}
		/* Invalid attempt to perform signed share */
		else {
			throw new Error('Invalid AccountFilesService.shareFile input.');
		}

		await this.databaseService.setItem(
			`users/${username}/incomingFiles/${id}`,
			BinaryProto,
			await this.potassiumService.box.seal(
				await serialize(AccountFileReferenceContainer, accountFileReferenceContainer),
				(await this.accountDatabaseService.getUserPublicKeys(username)).encryption
			)
		);

		await this.accountDatabaseService.notify(username, NotificationTypes.File, await fileType);
	}

	/** Overwrites an existing appointment. */
	public async updateAppointment (
		id: string,
		content: IAppointment,
		name?: string
	) : Promise<void> {
		const file		= await this.getFile(id, AccountFileRecord.RecordTypes.Appointment);
		file.timestamp	= await getTimestamp();

		if (name) {
			file.name	= name;
		}

		await Promise.all([
			this.accountDatabaseService.setItem(
				`users/${file.owner}/files/${id}`,
				Appointment,
				content,
				undefined,
				file.key
			),
			this.accountDatabaseService.setItem<IAccountFileRecord>(
				`users/${file.owner}/fileRecords/${id}`,
				AccountFileRecord,
				file,
				undefined,
				file.key
			)
		]);
	}

	/** Overwrites an existing doc. */
	public async updateDoc (id: string, delta: IQuillDelta|IQuillRange) : Promise<void> {
		const file	= await this.getFile(id);

		await this.accountDatabaseService.pushItem(
			`users/${file.owner}/docs/${id}`,
			BinaryProto,
			msgpack.encode(delta),
			undefined,
			file.key
		);
	}

	/** Updates file record with new metadata. */
	public async updateMetadata (id: string, metadata: {
		mediaType?: string;
		name?: string;
		size?: number;
	}) : Promise<void> {
		const original	= await this.getFile(id);

		await this.accountDatabaseService.setItem(
			`users/${original.owner}/fileRecords/${id}`,
			AccountFileRecord,
			{
				id,
				mediaType: metadata.mediaType === undefined ?
					original.mediaType :
					metadata.mediaType
				,
				name: metadata.name === undefined ? original.name : metadata.name,
				recordType: original.recordType,
				size: metadata.size === undefined ? original.size : metadata.size,
				timestamp: await getTimestamp()
			},
			undefined,
			original.key
		);
	}

	/** Overwrites an existing note. */
	public async updateNote (id: string, content: IQuillDelta, name?: string) : Promise<void> {
		const file		= await this.getFile(id, AccountFileRecord.RecordTypes.Note);
		file.size		= this.potassiumService.fromString(this.deltaToString(content)).length;
		file.timestamp	= await getTimestamp();

		if (name) {
			file.name	= name;
		}

		await Promise.all([
			this.accountDatabaseService.setItem(
				`users/${file.owner}/files/${id}`,
				BinaryProto,
				msgpack.encode(content),
				undefined,
				file.key
			),
			this.accountDatabaseService.setItem<IAccountFileRecord>(
				`users/${file.owner}/fileRecords/${id}`,
				AccountFileRecord,
				file,
				undefined,
				file.key
			)
		]);
	}

	/**
	 * Uploads new file.
	 * @param shareWithUser Username of another user to optionally share this file with.
	 */
	public upload (
		name: string,
		file: IQuillDelta|IQuillDelta[]|File|IAppointment|IForm,
		shareWithUser?: string
	) : {
		progress: Observable<number>;
		result: Promise<string>;
	} {
		let anonymous	= false;
		let username: string;

		if (this.accountDatabaseService.currentUser.value) {
			username	= this.accountDatabaseService.currentUser.value.user.username;
		}
		else if (shareWithUser) {
			anonymous	= true;
			username	= shareWithUser;
		}
		else {
			throw new Error('Invalid AccountFilesService.upload input.');
		}

		const id	= uuid();
		const key	= (async () => this.potassiumService.randomBytes(
			await this.potassiumService.secretBox.keyBytes
		))();
		const url	= `users/${username}/files/${id}`;

		const {progress, result}	= file instanceof Blob ?
			this.accountDatabaseService.uploadItem(url, BlobProto, file, undefined, key) :
			file instanceof Array ?
				(() => {
					const docProgress	= new BehaviorSubject(0);

					return {progress: docProgress, result: (async () => {
						for (let i = 0 ; i < file.length ; ++i) {
							docProgress.next(Math.round(i / file.length * 100));

							await this.accountDatabaseService.pushItem(
								`users/${username}/docs/${id}`,
								BinaryProto,
								msgpack.encode(file[i]),
								undefined,
								key
							);
						}

						docProgress.next(100);
						return {hash: '', url: ''};
					})()};
				})() :
				this.fileIsDelta(file) ?
					this.accountDatabaseService.uploadItem(
						url,
						BinaryProto,
						msgpack.encode(<IQuillDelta> file),
						undefined,
						key
					) :
					this.fileIsAppointment(file) ?
						this.accountDatabaseService.uploadItem(
							url,
							Appointment,
							<Appointment> file,
							undefined,
							key
						) :
						this.accountDatabaseService.uploadItem(
							url,
							Form,
							<Form> file,
							SecurityModels.privateSigned,
							key
						)
		;

		return {
			progress,
			result: result.then(async () => {
				const accountFileRecord	= {
					id,
					mediaType: file instanceof Blob ?
						file.type :
						file instanceof Array ?
							'cyph/doc' :
							this.fileIsDelta(file) ?
								'cyph/note' :
								this.fileIsAppointment(file) ?
									'cyph/appointment' :
									'cyph/form'
					,
					name,
					recordType: file instanceof Blob ?
						AccountFileRecord.RecordTypes.File :
						file instanceof Array ?
							AccountFileRecord.RecordTypes.Doc :
							this.fileIsDelta(file) ?
								AccountFileRecord.RecordTypes.Note :
								this.fileIsAppointment(file) ?
									AccountFileRecord.RecordTypes.Appointment :
									AccountFileRecord.RecordTypes.Form
					,
					size: file instanceof Blob ?
						file.size :
						!(file instanceof Array) && this.fileIsDelta(file) ?
							this.potassiumService.fromString(
								this.deltaToString(<IQuillDelta> file)
							).length :
							NaN
					,
					timestamp: await getTimestamp()
				};

				if (anonymous) {
					await this.shareFile({accountFileRecord, key: await key}, username);
				}
				else {
					await this.accountDatabaseService.setItem(
						`fileRecords/${id}`,
						AccountFileRecord,
						accountFileRecord,
						undefined,
						key
					);

					await this.accountDatabaseService.setItem(
						`fileReferences/${id}`,
						AccountFileReference,
						{
							id,
							key: await key,
							owner: username
						}
					);

					if (shareWithUser) {
						await this.shareFile(id, shareWithUser);
					}
				}

				return id;
			})
		};
	}

	/** Watches doc. */
	public async watchDoc (id: string) : Promise<{
		deltas: Observable<IQuillDelta>;
		selections: Observable<IQuillRange>;
	}> {
		const file		= await this.getFile(id);

		const length	=
			(
				await this.accountDatabaseService.getListKeys(`users/${file.owner}/docs/${id}`)
			).length
		;

		const doc		= this.accountDatabaseService.watchListPushes(
			`users/${file.owner}/docs/${id}`,
			BinaryProto,
			undefined,
			file.key
		).pipe(map(o =>
			o.value.length > 0 ? msgpack.decode(o.value) : undefined
		));

		return {
			deltas: of({
				clientID: '',
				ops: (await doc.pipe(take(length), toArray(), first()).toPromise() || []).
					filter(o => o && typeof o.index !== 'number').
					map<DeltaOperation[]>(o => o.ops || []).
					reduce<DeltaStatic>(
						(delta, ops) => delta.compose(new Delta(ops)),
						new Delta()
					).ops || []
			}).pipe(concat(
				doc.pipe(filter(o => o && typeof o.index !== 'number'))
			)),
			selections: doc.pipe(filter(o => o && typeof o.index === 'number'))
		};
	}

	/** Watches file record. */
	public watchMetadata (id: string) : Observable<IAccountFileRecord> {
		const filePromise	= this.getFile(id);

		return this.accountDatabaseService.watch(
			(async () => `users/${(await filePromise).owner}/fileRecords/${id}`)(),
			AccountFileRecord,
			undefined,
			(async () => (await filePromise).key)()
		).pipe(map(o =>
			o.value
		));
	}

	/** Watches note. */
	public watchNote (id: string) : Observable<IQuillDelta> {
		const filePromise	= this.getFile(id);

		return this.accountDatabaseService.watch(
			(async () => `users/${(await filePromise).owner}/files/${id}`)(),
			BinaryProto,
			undefined,
			(async () => (await filePromise).key)()
		).pipe(map(o =>
			o.value.length > 0 ? msgpack.decode(o.value) : {ops: []}
		));
	}

	constructor (
		/** @ignore */
		private readonly router: Router,

		/** @ignore */
		private readonly accountDatabaseService: AccountDatabaseService,

		/** @ignore */
		private readonly databaseService: DatabaseService,

		/** @ignore */
		private readonly dialogService: DialogService,

		/** @ignore */
		private readonly potassiumService: PotassiumService,

		/** @ignore */
		private readonly stringsService: StringsService
	) {
		(async () => {
			if ((await this.accountDatabaseService.getListKeys('fileReferences')).length === 0) {
				this.initiated		= true;
				this.showSpinner	= false;
			}
			else {
				this.filesList.pipe(
					filter(arr => arr.length > 0),
					take(1)
				).toPromise().then(() => {
					this.initiated		= true;
					this.showSpinner	= false;
				});
			}
		})();
	}
}
