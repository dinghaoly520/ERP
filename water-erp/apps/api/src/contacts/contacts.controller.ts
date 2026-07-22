import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ContactsService } from './contacts.service';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateContactDto, UpdateContactDto } from './dto/contacts.dto';

@Controller('contacts')
@UseGuards(AuthGuard)
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Post()
  @Roles('leader', 'admin', 'staff')
  create(@Body() dto: CreateContactDto) {
    return this.contactsService.create(dto);
  }

  @Get()
  findMany() {
    return this.contactsService.findMany();
  }

  @Get('by-name')
  findByName(@Query('name') name: string) {
    return this.contactsService.findByName(name);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.contactsService.findOne(id);
  }

  @Put(':id')
  @Roles('leader', 'admin', 'staff')
  update(@Param('id') id: string, @Body() dto: UpdateContactDto) {
    return this.contactsService.update(id, dto);
  }

  @Delete(':id')
  @Roles('leader', 'admin', 'staff')
  delete(@Param('id') id: string) {
    return this.contactsService.delete(id);
  }
}
